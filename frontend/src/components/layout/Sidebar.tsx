import {
	BarChart3,
	Boxes,
	CheckSquare,
	Compass,
	HelpCircle,
	Inbox,
	Layers,
	LifeBuoy,
	PlusCircle,
	ShieldCheck,
	Ticket as TicketIcon,
	Users,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import type { Role } from "../../types/api";

interface SidebarProps {
	mobileOpen: boolean;
	onCloseMobile: () => void;
}

interface NavItem {
	label: string;
	to: string;
	icon: typeof TicketIcon;
	roles: Role[];
}

const NAV_ITEMS: NavItem[] = [
	// Requester Navigation
	{
		label: "Dashboard",
		to: "/requester/dashboard",
		icon: Layers,
		roles: ["requester"],
	},
	{
		label: "My Tickets",
		to: "/requester/tickets",
		icon: TicketIcon,
		roles: ["requester"],
	},
	{
		label: "New Ticket",
		to: "/requester/tickets/new",
		icon: PlusCircle,
		roles: ["requester"],
	},

	// Assignee Navigation
	{
		label: "Assigned Work",
		to: "/assignee/tickets",
		icon: CheckSquare,
		roles: ["assignee"],
	},

	// Supervisor Navigation
	{
		label: "Overview",
		to: "/supervisor/dashboard",
		icon: BarChart3,
		roles: ["supervisor"],
	},
	{
		label: "Ticket Queue",
		to: "/supervisor/queue",
		icon: Inbox,
		roles: ["supervisor"],
	},

	{
		label: "Assets",
		to: "/supervisor/assets",
		icon: Boxes,
		roles: ["supervisor"],
	},

	// Admin Navigation
	{
		label: "Administration",
		to: "/admin/dashboard",
		icon: ShieldCheck,
		roles: ["admin"],
	},
	{
		label: "User Management",
		to: "/admin/users",
		icon: Users,
		roles: ["admin"],
	},
	{
		label: "Directory",
		to: "/admin/directory",
		icon: Boxes,
		roles: ["admin"],
	},
	{
		label: "All Tickets",
		to: "/admin/tickets",
		icon: Compass,
		roles: ["admin"],
	},
];

export function Sidebar({ mobileOpen, onCloseMobile }: SidebarProps) {
	const { role, user } = useAuth();
	const location = useLocation();

	const visibleNav = NAV_ITEMS.filter((item) => item.roles.includes(role));

	return (
		<>
			{mobileOpen && (
				<div
					className="sidebar-backdrop"
					onClick={onCloseMobile}
					aria-hidden="true"
				/>
			)}
			<aside className={`app-sidebar ${mobileOpen ? "open" : ""}`}>
				<div className="sidebar-brand">
					<div className="sidebar-logo">
						<LifeBuoy size={22} className="text-white" />
					</div>
					<div className="sidebar-brand-text">
						<span className="brand-name">SupportDesk</span>
						<span className="brand-version">Enterprise v1.2</span>
					</div>
				</div>

				<div className="sidebar-workspace-badge">
					<span className="workspace-label">Current Workspace</span>
					<span className="workspace-role">{role.toUpperCase()} CONSOLE</span>
				</div>

				<nav className="sidebar-nav">
					<div className="nav-group-title">MAIN MENU</div>
					<ul className="nav-list">
						{visibleNav.map((item) => {
							const Icon = item.icon;
							const isActive =
								location.pathname === item.to ||
								(item.to !== "/requester/dashboard" &&
									item.to !== "/supervisor/dashboard" &&
									item.to !== "/admin/dashboard" &&
									location.pathname.startsWith(item.to));

							return (
								<li key={item.to} className="nav-item">
									<Link
										to={item.to}
										className={`nav-link ${isActive ? "active" : ""}`}
										onClick={onCloseMobile}
									>
										<Icon size={18} className="nav-icon" />
										<span>{item.label}</span>
									</Link>
								</li>
							);
						})}
					</ul>
				</nav>

				<div className="sidebar-footer">
					<div className="sidebar-user-card">
						<div className="user-details">
							<span className="user-name">{user?.name || "Support User"}</span>
							<span className="user-email">
								{user?.email || "user@sts.internal"}
							</span>
						</div>
					</div>
					<div className="sidebar-help">
						<HelpCircle size={15} />
						<span>Help & Documentation</span>
					</div>
				</div>
			</aside>
		</>
	);
}
