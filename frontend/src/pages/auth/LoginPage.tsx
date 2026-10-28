import {
	AlertCircle,
	CheckCircle,
	Eye,
	EyeOff,
	LifeBuoy,
	Lock,
	Mail,
	ShieldCheck,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/common/Button";
import { Input } from "../../components/common/Input";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import type { Role } from "../../types/api";

export function LoginPage() {
	const { login, switchRole, mockMode, toggleMockMode } = useAuth();
	const { showToast } = useToast();
	const navigate = useNavigate();

	const [email, setEmail] = useState("jane.requester@example.com");
	const [password, setPassword] = useState("Password123!");
	const [showPassword, setShowPassword] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleLogin = async (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		setLoading(true);

		try {
			await login(email, password);
			showToast("Authenticated successfully. Welcome back!", "success");

			// Route based on role
			if (email.includes("admin")) {
				navigate("/admin/dashboard");
			} else if (email.includes("supervisor")) {
				navigate("/supervisor/dashboard");
			} else if (email.includes("assignee")) {
				navigate("/assignee/tickets");
			} else {
				navigate("/requester/dashboard");
			}
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: "Failed to authenticate. Check server connection.",
			);
		} finally {
			setLoading(false);
		}
	};

	const quickFillPersona = (role: Role, mail: string) => {
		setEmail(mail);
		setPassword("Password123!");
		setError(null);
		if (mockMode) {
			switchRole(role);
			showToast(`Loaded ${role.toUpperCase()} persona credentials`, "info");
		}
	};

	return (
		<div className="login-page">
			<div className="login-card-container">
				<div className="login-header">
					<div className="login-brand-icon">
						<LifeBuoy size={28} className="text-white" />
					</div>
					<h2 className="login-title">SupportDesk Enterprise</h2>
					<p className="login-subtitle">
						Sign in to manage service requests, dispatch assignees, and track
						incidents.
					</p>
				</div>

				{/* Quick Fill Demo Accounts */}
				<div className="demo-accounts-panel">
					<div className="demo-panel-header">
						<ShieldCheck size={14} className="text-primary" />
						<span>1-CLICK DEMO PERSONAS</span>
					</div>
					<div className="demo-persona-grid">
						<button
							type="button"
							className={`demo-persona-btn ${email.includes("requester") ? "selected" : ""}`}
							onClick={() =>
								quickFillPersona("requester", "jane.requester@example.com")
							}
						>
							<span className="persona-role">Requester</span>
							<span className="persona-name">Jane Doe</span>
						</button>
						<button
							type="button"
							className={`demo-persona-btn ${email.includes("assignee") ? "selected" : ""}`}
							onClick={() =>
								quickFillPersona("assignee", "alex.assignee@example.com")
							}
						>
							<span className="persona-role">Assignee</span>
							<span className="persona-name">Alex Rivera</span>
						</button>
						<button
							type="button"
							className={`demo-persona-btn ${email.includes("supervisor") ? "selected" : ""}`}
							onClick={() =>
								quickFillPersona("supervisor", "sarah.supervisor@example.com")
							}
						>
							<span className="persona-role">Supervisor</span>
							<span className="persona-name">Sarah Chen</span>
						</button>
						<button
							type="button"
							className={`demo-persona-btn ${email.includes("admin") ? "selected" : ""}`}
							onClick={() =>
								quickFillPersona("admin", "marcus.admin@example.com")
							}
						>
							<span className="persona-role">Administrator</span>
							<span className="persona-name">Marcus Vance</span>
						</button>
					</div>
				</div>

				{error && (
					<div className="login-error-alert" role="alert">
						<AlertCircle size={18} />
						<span>{error}</span>
					</div>
				)}

				<form onSubmit={handleLogin} className="login-form">
					<Input
						id="login-email"
						name="email"
						type="email"
						label="Work Email"
						placeholder="name@company.com"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						required
						leftIcon={<Mail size={16} />}
					/>

					<Input
						id="login-password"
						name="password"
						type={showPassword ? "text" : "password"}
						label="Password"
						placeholder="••••••••••••"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						required
						leftIcon={<Lock size={16} />}
						rightElement={
							<button
								type="button"
								className="password-toggle-btn"
								onClick={() => setShowPassword(!showPassword)}
								aria-label={showPassword ? "Hide password" : "Show password"}
							>
								{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
							</button>
						}
					/>

					<div className="login-options">
						<label className="remember-checkbox">
							<input
								type="checkbox"
								checked={mockMode}
								onChange={(e) => toggleMockMode(e.target.checked)}
							/>
							<span className="text-sm">
								Enable Demo Mock Mode (recommended if backend is 501)
							</span>
						</label>
					</div>

					<Button
						type="submit"
						variant="primary"
						size="lg"
						isLoading={loading}
						className="w-full mt-2"
					>
						Sign In to Console
					</Button>
				</form>

				<div className="login-footer">
					<div className="login-status-badge">
						<CheckCircle size={13} className="text-success" />
						<span>Vite 8 • Port 3000 • FastAPI /api/v1 aligned</span>
					</div>
				</div>
			</div>
		</div>
	);
}
