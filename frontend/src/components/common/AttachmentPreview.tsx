import { FileText, ImageOff } from "lucide-react";
import { useEffect, useState } from "react";
import { ticketService } from "../../services/ticketService";
import type { TicketAttachment } from "../../types/api";

const isApiPath = (url: string) => url.startsWith("/api/");

interface AttachmentPreviewProps {
	attachment: TicketAttachment;
}

/**
 * Thumbnail for an attachment. Uploaded files are served by the API and need
 * the Bearer token, so they are fetched and shown from an object URL; old
 * attachments (external links) and mock-mode data URLs are used directly.
 */
export function AttachmentPreview({ attachment }: AttachmentPreviewProps) {
	const { storageUrl, contentType, filename } = attachment;
	const [src, setSrc] = useState<string | null>(
		isApiPath(storageUrl) ? null : storageUrl,
	);
	const [failed, setFailed] = useState(false);
	const isPdf =
		contentType === "application/pdf" ||
		storageUrl.startsWith("data:application/pdf");

	useEffect(() => {
		setFailed(false);
		if (!isApiPath(storageUrl)) {
			setSrc(storageUrl);
			return;
		}
		let objectUrl: string | null = null;
		let cancelled = false;
		setSrc(null);
		ticketService
			.downloadAttachment(attachment)
			.then((blob) => {
				if (cancelled) return;
				objectUrl = URL.createObjectURL(blob);
				setSrc(objectUrl);
			})
			.catch(() => {
				if (!cancelled) setFailed(true);
			});
		return () => {
			cancelled = true;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	}, [attachment, storageUrl]);

	if (failed) {
		return (
			<div
				className="attachment-placeholder"
				role="img"
				aria-label="Unavailable"
			>
				<ImageOff size={28} />
				<span>Unavailable</span>
			</div>
		);
	}
	if (isPdf) {
		return (
			<div className="attachment-placeholder">
				<FileText size={28} />
				{src ? (
					<a
						href={src}
						target="_blank"
						rel="noreferrer"
						download={filename ?? "file.pdf"}
					>
						{filename ?? "Open PDF"}
					</a>
				) : (
					<span>Loading…</span>
				)}
			</div>
		);
	}
	if (!src) {
		return <div className="attachment-placeholder">Loading…</div>;
	}
	return (
		<img
			src={src}
			alt={filename ?? "Ticket attachment"}
			onError={() => setFailed(true)}
		/>
	);
}
