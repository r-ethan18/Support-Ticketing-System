import {
	AlertCircle,
	AlertTriangle,
	CheckCircle2,
	Info,
	X,
} from "lucide-react";
import { type ToastItem, useToast } from "../../context/ToastContext";

export function ToastContainer() {
	const { toasts, removeToast } = useToast();

	if (toasts.length === 0) return null;

	const getIcon = (type: ToastItem["type"]) => {
		switch (type) {
			case "success":
				return <CheckCircle2 className="toast-icon text-success" size={18} />;
			case "error":
				return <AlertCircle className="toast-icon text-danger" size={18} />;
			case "warning":
				return <AlertTriangle className="toast-icon text-warning" size={18} />;
			default:
				return <Info className="toast-icon text-primary" size={18} />;
		}
	};

	return (
		<div className="toast-container" aria-live="polite" aria-atomic="true">
			{toasts.map((toast) => (
				<div
					key={toast.id}
					className={`toast-item toast-${toast.type}`}
					role="status"
				>
					<div className="toast-content">
						{getIcon(toast.type)}
						<span className="toast-message">{toast.message}</span>
					</div>
					<button
						type="button"
						className="toast-close-btn"
						onClick={() => removeToast(toast.id)}
						aria-label="Close notification"
					>
						<X size={14} />
					</button>
				</div>
			))}
		</div>
	);
}
