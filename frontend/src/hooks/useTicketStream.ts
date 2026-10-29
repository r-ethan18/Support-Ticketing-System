/**
 * useTicketStream – React hook for real-time ticket updates via SSE.
 *
 * Opens a Server-Sent Events connection to /api/v1/tickets/{ticketId}/stream
 * and calls the provided callbacks as the server pushes events. The connection
 * is torn down when the component unmounts or ticketId changes, and re-opened
 * with backoff if it drops.
 *
 * SSE requires the Authorization header, but the native EventSource API does
 * not support custom headers.  We work around this by using `fetch()` with
 * manual stream reading — the same technique used by OpenAI's streaming APIs.
 *
 * Returns whether the stream is currently connected. Live mode only: in mock
 * mode (no live backend) this hook does nothing.
 */

import { useEffect, useRef, useState } from "react";
import { getStoredToken } from "../services/apiClient";
import { isMockMode } from "../services/ticketService";
import type { TicketComment, TicketStatus } from "../types/api";

export interface TicketStreamCallbacks {
	onComment: (comment: TicketComment) => void;
	onStatus: (ticketId: string, status: TicketStatus, changedAt: string) => void;
	/** Assignees were added or removed. */
	onAssignment: () => void;
	/**
	 * Events may have been missed (server-side overflow, or the stream was
	 * re-established after a drop): reload the ticket's data.
	 */
	onResync: () => void;
}

const MAX_BACKOFF_MS = 30_000;

type Outcome = "dropped" | "ended";

export function useTicketStream(
	ticketId: string | undefined,
	callbacks: TicketStreamCallbacks,
): boolean {
	const [connected, setConnected] = useState(false);

	// Keep a stable reference so we don't re-subscribe on every render.
	const callbacksRef = useRef(callbacks);
	useEffect(() => {
		callbacksRef.current = callbacks;
	}, [callbacks]);

	useEffect(() => {
		if (!ticketId || isMockMode()) return;

		const controller = new AbortController();
		let attempt = 0;
		let hasConnectedBefore = false;

		async function run(id: string) {
			while (!controller.signal.aborted) {
				const outcome = await readStream(id, controller.signal, {
					onOpen: () => {
						attempt = 0;
						setConnected(true);
						// Anything pushed while we were away was lost.
						if (hasConnectedBefore) callbacksRef.current.onResync();
						hasConnectedBefore = true;
					},
					dispatch: (type, payload) =>
						dispatch(type, payload, callbacksRef.current),
				});
				setConnected(false);
				if (outcome === "ended" || controller.signal.aborted) return;
				const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt++);
				await sleep(delay, controller.signal);
			}
		}

		run(ticketId);

		return () => {
			controller.abort();
			setConnected(false);
		};
	}, [ticketId]);

	return connected;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
	});
}

/**
 * Read one connection until it closes. "ended" means the server will not
 * allow (or no longer allows) this stream, so reconnecting would be pointless.
 */
async function readStream(
	id: string,
	signal: AbortSignal,
	handlers: {
		onOpen: () => void;
		dispatch: (type: string, payload: Record<string, unknown>) => void;
	},
): Promise<Outcome> {
	const token = getStoredToken();
	const url = `/api/v1/tickets/${id}/stream`;

	let response: Response;
	try {
		response = await fetch(url, {
			headers: {
				Accept: "text/event-stream",
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			signal,
			// Disable response buffering in the browser so chunks arrive
			// as soon as the server sends them.
			cache: "no-store",
		});
	} catch (err) {
		if ((err as Error)?.name !== "AbortError") {
			console.warn("[useTicketStream] fetch failed:", err);
		}
		return "dropped";
	}

	if (!response.ok || !response.body) {
		console.warn(`[useTicketStream] HTTP ${response.status} for ${url}`);
		// Auth/visibility failures won't fix themselves; other errors might.
		return [401, 403, 404].includes(response.status) ? "ended" : "dropped";
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let ended = false;

	// Each SSE message is delimited by a blank line (\n\n).
	// We accumulate text and parse complete messages out of the buffer.
	while (true) {
		let done: boolean;
		let value: Uint8Array | undefined;
		try {
			({ done, value } = await reader.read());
		} catch {
			// Connection closed or aborted.
			break;
		}
		if (done) break;

		buffer += decoder.decode(value, { stream: true });

		const messages = buffer.split("\n\n");
		// The last element may be an incomplete message; keep it in the buffer.
		buffer = messages.pop() ?? "";

		for (const message of messages) {
			const parsed = parseMessage(message);
			if (!parsed) continue;
			if (parsed.type === "connected") handlers.onOpen();
			else if (parsed.type === "closed" || parsed.type === "deleted") {
				handlers.dispatch(parsed.type, parsed.payload);
				ended = true;
			} else handlers.dispatch(parsed.type, parsed.payload);
		}
		if (ended) break;
	}
	await reader.cancel().catch(() => {});
	return ended ? "ended" : "dropped";
}

// ---------------------------------------------------------------------------
// SSE message parser
// ---------------------------------------------------------------------------

function parseMessage(
	raw: string,
): { type: string; payload: Record<string, unknown> } | null {
	let eventType = "message";
	let dataLine = "";

	for (const line of raw.split("\n")) {
		if (line.startsWith("event:")) {
			eventType = line.slice("event:".length).trim();
		} else if (line.startsWith("data:")) {
			dataLine = line.slice("data:".length).trim();
		}
		// Lines starting with ":" are SSE comments (heartbeats). Ignore them.
	}

	if (!dataLine) return null;

	try {
		return {
			type: eventType,
			payload: JSON.parse(dataLine) as Record<string, unknown>,
		};
	} catch {
		console.warn("[useTicketStream] Could not parse SSE payload:", dataLine);
		return null;
	}
}

function dispatch(
	type: string,
	payload: Record<string, unknown>,
	callbacks: TicketStreamCallbacks,
): void {
	switch (type) {
		case "comment":
			callbacks.onComment(payload as unknown as TicketComment);
			break;
		case "status":
			callbacks.onStatus(
				payload.ticketId as string,
				payload.status as TicketStatus,
				payload.changedAt as string,
			);
			break;
		case "assignment":
			callbacks.onAssignment();
			break;
		case "resync":
			callbacks.onResync();
			break;
		default:
			// "connected" is handled by the reader; "closed" / "deleted" end the stream.
			break;
	}
}
