import {
	AlertCircle,
	Database,
	Eye,
	EyeOff,
	LifeBuoy,
	Lock,
	Mail,
	Phone,
	ShieldCheck,
	User,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/common/Button";
import { Input } from "../../components/common/Input";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { DEMO_CREDENTIALS } from "../../services/authService";
import type { Person, Role } from "../../types/api";

export function LoginPage() {
	const { login, register, switchRole, mockMode, toggleMockMode } = useAuth();
	const { showToast } = useToast();
	const navigate = useNavigate();

	const [mode, setMode] = useState<"signin" | "signup">("signin");
	const [name, setName] = useState("");
	const [phone, setPhone] = useState("");
	const [email, setEmail] = useState("requester@example.com");
	const [password, setPassword] = useState("requesterpassword123");
	const [showPassword, setShowPassword] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const switchMode = (next: "signin" | "signup") => {
		setMode(next);
		setError(null);
		if (next === "signup") {
			setEmail("");
			setPassword("");
		}
	};

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		setError(null);

		if (mode === "signup" && password.length < 12) {
			setError("Password must be at least 12 characters.");
			return;
		}

		setLoading(true);

		try {
			let person: Person;
			if (mode === "signup") {
				person = await register({
					name: name.trim(),
					email: email.trim(),
					phone: phone.trim(),
					password,
				});
				showToast(`Account created. Welcome, ${person.name}!`, "success");
			} else {
				person = await login(email, password);
				showToast(`Authenticated as ${person.name}. Welcome back!`, "success");
			}

			// Route based on actual role
			if (person.role === "admin") {
				navigate("/admin/dashboard");
			} else if (person.role === "supervisor") {
				navigate("/supervisor/dashboard");
			} else if (person.role === "assignee") {
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

	const quickFillPersona = (role: Role) => {
		const cred = DEMO_CREDENTIALS[role];
		setEmail(cred.email);
		setPassword(cred.password);
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
				{mode === "signin" && (
					<div className="demo-accounts-panel">
						<div className="demo-panel-header">
							<ShieldCheck size={14} className="text-primary" />
							<span>1-CLICK DEMO PERSONAS</span>
						</div>
						<div className="demo-persona-grid">
							<button
								type="button"
								className={`demo-persona-btn ${email.includes("requester") ? "selected" : ""}`}
								onClick={() => quickFillPersona("requester")}
							>
								<span className="persona-role">Requester</span>
								<span className="persona-name">Alice Chen</span>
							</button>
							<button
								type="button"
								className={`demo-persona-btn ${email.includes("assignee") ? "selected" : ""}`}
								onClick={() => quickFillPersona("assignee")}
							>
								<span className="persona-role">Assignee</span>
								<span className="persona-name">Carlos Mendoza</span>
							</button>
							<button
								type="button"
								className={`demo-persona-btn ${email.includes("supervisor") ? "selected" : ""}`}
								onClick={() => quickFillPersona("supervisor")}
							>
								<span className="persona-role">Supervisor</span>
								<span className="persona-name">David Miller</span>
							</button>
							<button
								type="button"
								className={`demo-persona-btn ${email.includes("admin") ? "selected" : ""}`}
								onClick={() => quickFillPersona("admin")}
							>
								<span className="persona-role">Administrator</span>
								<span className="persona-name">Administrator</span>
							</button>
						</div>
					</div>
				)}

				{error && (
					<div className="login-error-alert" role="alert">
						<AlertCircle size={18} />
						<span>{error}</span>
					</div>
				)}

				<form onSubmit={handleSubmit} className="login-form">
					{mode === "signup" && (
						<>
							<Input
								id="signup-name"
								name="name"
								label="Full Name"
								placeholder="Jane Doe"
								value={name}
								onChange={(e) => setName(e.target.value)}
								required
								leftIcon={<User size={16} />}
							/>
							<Input
								id="signup-phone"
								name="phone"
								type="tel"
								label="Phone Number"
								placeholder="+1-555-0100"
								value={phone}
								onChange={(e) => setPhone(e.target.value)}
								required
								leftIcon={<Phone size={16} />}
							/>
						</>
					)}

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
						minLength={mode === "signup" ? 12 : undefined}
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
								Enable Demo Mock Mode (localStorage simulation)
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
						{mode === "signup" ? "Create Account" : "Sign In to Console"}
					</Button>

					<p className="text-sm text-center mt-2">
						{mode === "signup" ? (
							<>
								Already have an account?{" "}
								<button
									type="button"
									className="link-button"
									onClick={() => switchMode("signin")}
								>
									Sign in
								</button>
							</>
						) : (
							<>
								New here?{" "}
								<button
									type="button"
									className="link-button"
									onClick={() => switchMode("signup")}
								>
									Create an account
								</button>
							</>
						)}
					</p>
				</form>

				<div className="login-footer">
					<div className="login-status-badge">
						{mockMode ? (
							<>
								<span className="mock-indicator-dot" />
								<span>Offline Mock Mode Active</span>
							</>
						) : (
							<>
								<Database size={13} className="text-success" />
								<span>Connected to Live Backend (/api/v1)</span>
							</>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
