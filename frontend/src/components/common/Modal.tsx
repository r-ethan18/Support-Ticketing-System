import { X } from "lucide-react";
import { type ReactNode, useEffect } from "react";

interface ModalProps {
	isOpen: boolean;
	onClose: () => void;
	title: string;
	description?: string;
	children: ReactNode;
	footer?: ReactNode;
	maxWidth?: "sm" | "md" | "lg" | "xl";
}

export function Modal({
	isOpen,
	onClose,
	title,
	description,
	children,
	footer,
	maxWidth = "md",
}: ModalProps) {
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape" && isOpen) {
				onClose();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, onClose]);

	if (!isOpen) return null;

	return (
		<div
			className="modal-backdrop"
			role="dialog"
			aria-modal="true"
			aria-labelledby="modal-title"
			tabIndex={-1}
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose();
			}}
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div className={`modal-container modal-${maxWidth}`}>
				<div className="modal-header">
					<div>
						<h3 id="modal-title" className="modal-title">
							{title}
						</h3>
						{description && <p className="modal-description">{description}</p>}
					</div>
					<button
						type="button"
						className="modal-close-btn"
						onClick={onClose}
						aria-label="Close modal"
					>
						<X size={18} />
					</button>
				</div>

				<div className="modal-body">{children}</div>

				{footer && <div className="modal-footer">{footer}</div>}
			</div>
		</div>
	);
}
