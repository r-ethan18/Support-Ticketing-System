import { Compass, Home } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/common/Button";
import { useAuth } from "../../context/AuthContext";

export function NotFoundPage() {
	const { role, isAuthenticated } = useAuth();
	const navigate = useNavigate();

	const handleGoHome = () => {
		if (!isAuthenticated) {
			navigate("/login");
			return;
		}

		switch (role) {
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
			default:
				navigate("/login");
		}
	};

	return (
		<div className="not-found-page">
			<div className="not-found-card">
				<div className="not-found-icon-wrap">
					<Compass size={48} className="text-primary" />
				</div>
				<h1 className="not-found-code">404</h1>
				<h2 className="not-found-title">Page Not Found</h2>
				<p className="not-found-desc">
					The page you are looking for doesn't exist, has been relocated, or is
					restricted under your current security clearance.
				</p>
				<Button
					variant="primary"
					size="lg"
					icon={<Home size={16} />}
					onClick={handleGoHome}
				>
					Return to Workspace
				</Button>
			</div>
		</div>
	);
}
