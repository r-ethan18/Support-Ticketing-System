import type { ReactNode } from "react";
import type { Role, TicketPriority, TicketStatus } from "../../types/api";

interface BadgeProps {
	children: ReactNode;
	variant?: "default" | "status" | "priority" | "role" | "neutral";
	status?: TicketStatus;
	priority?: TicketPriority;
	role?: Role;
	size?: "sm" | "md";
	className?: string;
}

export function Badge({
	children,
	variant = "default",
	status,
	priority,
	role,
	size = "md",
	className = "",
}: BadgeProps) {
	let badgeClass = `badge badge-${size} ${className}`;

	if (variant === "status" && status) {
		badgeClass += ` badge-status-${status}`;
	} else if (variant === "priority" && priority) {
		badgeClass += ` badge-priority-${priority}`;
	} else if (variant === "role" && role) {
		badgeClass += ` badge-role-${role}`;
	} else {
		badgeClass += " badge-neutral";
	}

	return <span className={badgeClass}>{children}</span>;
}

export function StatusBadge({
	status,
	size = "md",
}: {
	status: TicketStatus;
	size?: "sm" | "md";
}) {
	const labels: Record<TicketStatus, string> = {
		open: "Open",
		assigned: "Assigned",
		in_progress: "In Progress",
		resolved: "Resolved",
		closed: "Closed",
	};

	return (
		<Badge variant="status" status={status} size={size}>
			<span className="badge-dot" />
			<span>{labels[status]}</span>
		</Badge>
	);
}

export function PriorityBadge({
	priority,
	size = "md",
}: {
	priority: TicketPriority;
	size?: "sm" | "md";
}) {
	const labels: Record<TicketPriority, string> = {
		low: "Low",
		medium: "Medium",
		high: "High",
		critical: "Critical",
	};

	return (
		<Badge variant="priority" priority={priority} size={size}>
			<span>{labels[priority]}</span>
		</Badge>
	);
}

export function RoleBadge({
	role,
	size = "sm",
}: {
	role: Role;
	size?: "sm" | "md";
}) {
	const labels: Record<Role, string> = {
		requester: "Requester",
		assignee: "Assignee",
		supervisor: "Supervisor",
		admin: "Administrator",
	};

	return (
		<Badge variant="role" role={role} size={size}>
			{labels[role]}
		</Badge>
	);
}
