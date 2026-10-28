import { Database, LogOut, Menu, RotateCcw, UserCheck } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import type { Role } from "../../types/api";
import { Avatar } from "../common/Avatar";
import { RoleBadge } from "../common/Badge";

interface TopNavbarProps {
	onToggleMobileSidebar: () => void;
	pageTitle?: string;
}

export function TopNavbar({
	onToggleMobileSidebar,
	pageTitle = "Overview",
}: TopNavbarProps) {
	const {
		user,
		role,
		switchRole,
		logout,
		mockMode,
		toggleMockMode,
		resetDemoData,
	} = useAuth();
	const { showToast } = useToast();
	const navigate = useNavigate();
	const [roleMenuOpen, setRoleMenuOpen] = useState(false);

	const handleRoleSwitch = (newRole: Role) => {
		switchRole(newRole);
		setRoleMenuOpen(false);
		showToast(`Switched workspace to ${newRole.toUpperCase()}`, "info");

		// Route to appropriate default landing for role
		switch (newRole) {
			case "requester":
				navigate("/requester/dashboard");
				break;
			case "assignee":
				navigate("/assignee/tickets");
				break;
			case "supervisor":
				navigate("/supervisor/dashboard");
				break;
			case "admin":
				navigate("/admin/dashboard");
				break;
		}
	};

	const handleSignOut = () => {
		logout();
		navigate("/login");
		showToast("Signed out successfully", "info");
	};

	const handleResetData = () => {
		resetDemoData();
		showToast(
			"Reset mock tickets, comments, and people data to initial state",
			"success",
		);
		window.location.reload();
	};

	return (
		<header className="top-navbar">
			<div className="navbar-left">
				<button
					type="button"
					className="mobile-menu-trigger"
					onClick={onToggleMobileSidebar}
					aria-label="Toggle navigation menu"
				>
					<Menu size={20} />
				</button>
				<h1 className="navbar-page-title">{pageTitle}</h1>
			</div>

			<div className="navbar-right">
				{/* Mock Mode / Live API Toggle */}
				<button
					type="button"
					className={`mode-indicator-pill ${mockMode ? "pill-mock" : "pill-live"}`}
					onClick={() => {
						const next = !mockMode;
						toggleMockMode(next);
						showToast(
							next
								? "Switched to Mock Data Mode (persistent demo store)"
								: "Switched to Live Backend Mode (proxies to /api/v1)",
							"info",
						);
					}}
					title="Click to toggle between Mock Mode and Live Backend Mode"
				>
					<Database size={14} />
					<span>{mockMode ? "Demo / Mock Mode" : "Live Backend (/api)"}</span>
				</button>

				{mockMode && (
					<button
						type="button"
						className="icon-action-btn"
						onClick={handleResetData}
						title="Reset mock data to fresh defaults"
					>
						<RotateCcw size={16} />
					</button>
				)}

				{/* Role Switcher Menu */}
				<div className="relative">
					<button
						type="button"
						className="role-switch-trigger"
						onClick={() => setRoleMenuOpen(!roleMenuOpen)}
					>
						<UserCheck size={15} className="text-primary" />
						<span className="switch-label">Role:</span>
						<RoleBadge role={role} size="sm" />
					</button>

					{roleMenuOpen && (
						<div className="role-menu-dropdown" role="menu">
							<div className="dropdown-header">SWITCH ACTIVE ROLE</div>
							<button
								type="button"
								className={`dropdown-item ${role === "requester" ? "active" : ""}`}
								onClick={() => handleRoleSwitch("requester")}
							>
								<div className="item-title">Requester</div>
								<div className="item-sub">Jane Doe (Employee)</div>
							</button>
							<button
								type="button"
								className={`dropdown-item ${role === "assignee" ? "active" : ""}`}
								onClick={() => handleRoleSwitch("assignee")}
							>
								<div className="item-title">Assignee</div>
								<div className="item-sub">Alex Rivera (Field Tech)</div>
							</button>
							<button
								type="button"
								className={`dropdown-item ${role === "supervisor" ? "active" : ""}`}
								onClick={() => handleRoleSwitch("supervisor")}
							>
								<div className="item-title">Supervisor</div>
								<div className="item-sub">Sarah Chen (Dept Lead)</div>
							</button>
							<button
								type="button"
								className={`dropdown-item ${role === "admin" ? "active" : ""}`}
								onClick={() => handleRoleSwitch("admin")}
							>
								<div className="item-title">Administrator</div>
								<div className="item-sub">Marcus Vance (Ops Admin)</div>
							</button>
						</div>
					)}
				</div>

				<div className="navbar-divider" />

				{/* User Profile & Sign Out */}
				<div className="user-profile-menu">
					<Avatar name={user?.name || "User"} size="sm" />
					<div className="user-meta">
						<span className="user-name">{user?.name || "Support User"}</span>
					</div>
					<button
						type="button"
						className="icon-action-btn text-muted hover-danger"
						onClick={handleSignOut}
						title="Sign out"
						aria-label="Sign out"
					>
						<LogOut size={16} />
					</button>
				</div>
			</div>
		</header>
	);
}
