import type { ReactNode } from "react";
import type {
	Role,
	TicketPriority,
	TicketStatus,
	TicketStatusFilter,
} from "../../types/api";

interface BadgeProps {
	children: ReactNode;
	variant?: "default" | "status" | "priority" | "role" | "neutral";
	status?: TicketStatusFilter;
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
	reopenRequested,
	size = "md",
}: {
	status: TicketStatus | "reopen_requested";
	reopenRequested?: boolean;
	size?: "sm" | "md";
}) {
	const effectiveStatus: TicketStatusFilter = reopenRequested
		? "reopen_requested"
		: status;

	const labels: Record<TicketStatusFilter, string> = {
		open: "Open",
		assigned: "Assigned",
		in_progress: "In Progress",
		resolved: "Resolved",
		closed: "Closed",
		reopen_requested: "Reopen Requested",
	};

	return (
		<Badge variant="status" status={effectiveStatus} size={size}>
			<span className="badge-dot" />
			<span>{labels[effectiveStatus]}</span>
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
