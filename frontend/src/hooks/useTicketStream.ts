/**
 * useTicketStream – React hook for real-time ticket updates via SSE.
 *
 * Opens a Server-Sent Events connection to /api/v1/tickets/{ticketId}/stream
 * and calls the provided callbacks whenever the server pushes a "comment" or
 * "status" event.  The connection is closed and re-opened whenever ticketId
 * changes, and is torn down when the component unmounts.
 *
 * SSE requires the Authorization header, but the native EventSource API does
 * not support custom headers.  We work around this by using `fetch()` with
 * manual stream reading — the same technique used by OpenAI's streaming APIs.
 *
 * Live mode only: in mock mode (no live backend) this hook does nothing.
 */

import { useCallback, useEffect, useRef } from "react";
import { getStoredToken } from "../services/apiClient";
import { isMockMode } from "../services/ticketService";
import type { TicketComment, TicketStatus } from "../types/api";

export interface TicketStreamCallbacks {
	onComment: (comment: TicketComment) => void;
	onStatus: (ticketId: string, status: TicketStatus, changedAt: string) => void;
}

export function useTicketStream(
	ticketId: string | undefined,
	{ onComment, onStatus }: TicketStreamCallbacks,
): void {
	// Keep stable references to the callbacks so we don't re-subscribe on every render.
	const onCommentRef = useRef(onComment);
	const onStatusRef = useRef(onStatus);
	useEffect(() => {
		onCommentRef.current = onComment;
	}, [onComment]);
	useEffect(() => {
		onStatusRef.current = onStatus;
	}, [onStatus]);

	// Abort controller lets us cleanly cancel the fetch when unmounting.
	const abortRef = useRef<AbortController | null>(null);

	const connect = useCallback(async (id: string) => {
		// Abort any previous connection.
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;

		const token = getStoredToken();
		const url = `/api/v1/tickets/${id}/stream`;

		let response: Response;
		try {
			response = await fetch(url, {
				headers: {
					Accept: "text/event-stream",
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				signal: controller.signal,
				// Disable response buffering in the browser so chunks arrive
				// as soon as the server sends them.
				cache: "no-store",
			});
		} catch (err) {
			if ((err as Error)?.name !== "AbortError") {
				console.warn("[useTicketStream] fetch failed:", err);
			}
			return;
		}

		if (!response.ok || !response.body) {
			console.warn(`[useTicketStream] HTTP ${response.status} for ${url}`);
			return;
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

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

			// Extract and process all complete SSE messages from the buffer.
			const messages = buffer.split("\n\n");
			// The last element may be an incomplete message; keep it in the buffer.
			buffer = messages.pop() ?? "";

			for (const message of messages) {
				parseAndDispatch(message, onCommentRef, onStatusRef);
			}
		}
	}, []);

	useEffect(() => {
		if (!ticketId || isMockMode()) return;

		connect(ticketId);

		return () => {
			abortRef.current?.abort();
			abortRef.current = null;
		};
	}, [ticketId, connect]);
}

// ---------------------------------------------------------------------------
// SSE message parser
// ---------------------------------------------------------------------------

function parseAndDispatch(
	raw: string,
	onCommentRef: React.MutableRefObject<TicketStreamCallbacks["onComment"]>,
	onStatusRef: React.MutableRefObject<TicketStreamCallbacks["onStatus"]>,
): void {
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

	if (!dataLine) return;

	let payload: Record<string, unknown>;
	try {
		payload = JSON.parse(dataLine) as Record<string, unknown>;
	} catch {
		console.warn("[useTicketStream] Could not parse SSE payload:", dataLine);
		return;
	}

	switch (eventType) {
		case "comment":
			onCommentRef.current(payload as unknown as TicketComment);
			break;
		case "status":
			onStatusRef.current(
				payload.ticketId as string,
				payload.status as TicketStatus,
				payload.changedAt as string,
			);
			break;
		case "connected":
			// Informational — no action needed.
			break;
		default:
			break;
	}
}
