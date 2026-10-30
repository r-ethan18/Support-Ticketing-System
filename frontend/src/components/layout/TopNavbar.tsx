import { KeyRound, LogOut, Menu } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Avatar } from "../common/Avatar";
import { RoleBadge } from "../common/Badge";
import { ThemeToggle } from "../common/ThemeToggle";
import { ChangePasswordModal } from "./ChangePasswordModal";

interface TopNavbarProps {
	onToggleMobileSidebar: () => void;
	pageTitle?: string;
}

export function TopNavbar({
	onToggleMobileSidebar,
	pageTitle = "Overview",
}: TopNavbarProps) {
	const { user, role, logout, mockMode } = useAuth();
	const { showToast } = useToast();
	const navigate = useNavigate();
	const [passwordModalOpen, setPasswordModalOpen] = useState(false);

	const handleSignOut = () => {
		logout();
		navigate("/login");
		showToast("Signed out successfully", "info");
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
				{/* Dark Mode Toggle */}
				<ThemeToggle />

				<div className="navbar-divider" />

				{/* User Profile, Assigned Role, and Sign Out */}
				<div className="user-profile-menu">
					<Avatar name={user?.name || "User"} size="sm" />
					<div className="user-meta">
						<span className="user-name">{user?.name || "Support User"}</span>
						<RoleBadge role={role} size="sm" />
					</div>
					{!mockMode && (
						<button
							type="button"
							className="icon-action-btn text-muted"
							onClick={() => setPasswordModalOpen(true)}
							title="Change password"
							aria-label="Change password"
						>
							<KeyRound size={16} />
						</button>
					)}
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

			<ChangePasswordModal
				isOpen={passwordModalOpen}
				onClose={() => setPasswordModalOpen(false)}
			/>
		</header>
	);
}
