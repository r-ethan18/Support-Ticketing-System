import { Inbox } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
	icon?: ReactNode;
	title: string;
	description: string;
	action?: ReactNode;
	className?: string;
}

export function EmptyState({
	icon,
	title,
	description,
	action,
	className = "",
}: EmptyStateProps) {
	return (
		<div className={`empty-state ${className}`}>
			<div className="empty-state-icon">
				{icon || <Inbox size={36} strokeWidth={1.5} />}
			</div>
			<h4 className="empty-state-title">{title}</h4>
			<p className="empty-state-description">{description}</p>
			{action && <div className="empty-state-action">{action}</div>}
		</div>
	);
}
