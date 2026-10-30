import {
	AlertCircle,
	CheckCircle2,
	Eye,
	EyeOff,
	LifeBuoy,
	Lock,
	Mail,
	Phone,
	User,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/common/Button";
import { Input } from "../../components/common/Input";
import { ThemeToggle } from "../../components/common/ThemeToggle";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import type { Person } from "../../types/api";

export function LoginPage() {
	const { login, register } = useAuth();
	const { showToast } = useToast();
	const navigate = useNavigate();

	const [mode, setMode] = useState<"signin" | "signup">("signin");
	const [name, setName] = useState("");
	const [phone, setPhone] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const switchMode = (next: "signin" | "signup") => {
		setMode(next);
		setError(null);
		setEmail("");
		setPassword("");
		setConfirmPassword("");
		setName("");
		setPhone("");
	};

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		setError(null);

		if (mode === "signup") {
			if (password.length < 12) {
				setError("Password must be at least 12 characters.");
				return;
			}
			if (password !== confirmPassword) {
				setError("Passwords do not match.");
				return;
			}
		}

		setLoading(true);

		try {
			let person: Person;
			if (mode === "signup") {
				person = await register({
					name: name.trim(),
					email: email.trim(),
					phone: phone.trim() || "+1-555-0100",
					password,
				});
				showToast(
					`Account created for ${person.name}. Roles are assigned by an administrator.`,
					"success",
				);
			} else {
				person = await login(email.trim(), password);
				showToast(`Welcome back, ${person.name}!`, "success");
			}

			// Route based on authenticated server role
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
					: "Authentication failed. Please verify credentials.",
			);
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="login-page">
			{/* Top Bar with Theme Toggle */}
			<div className="login-top-bar">
				<ThemeToggle showLabel />
			</div>

			<div className="login-card-container">
				<div className="login-header">
					<div className="login-brand-icon">
						<LifeBuoy size={28} className="text-white" />
					</div>
					<h2 className="login-title">SupportDesk Enterprise</h2>
					<p className="login-subtitle">
						{mode === "signin"
							? "Sign in to access your ticketing console, work orders, and services."
							: "Create your employee account. Roles are assigned by system administrators."}
					</p>
				</div>

				{/* Mode Tabs */}
				<div className="login-mode-tabs" role="tablist">
					<button
						type="button"
						role="tab"
						aria-selected={mode === "signin"}
						className={`login-tab-btn ${mode === "signin" ? "active" : ""}`}
						onClick={() => switchMode("signin")}
					>
						Sign In
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={mode === "signup"}
						className={`login-tab-btn ${mode === "signup" ? "active" : ""}`}
						onClick={() => switchMode("signup")}
					>
						Register
					</button>
				</div>

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
								placeholder="e.g. John Doe"
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
								placeholder="+1 (555) 234-5678"
								value={phone}
								onChange={(e) => setPhone(e.target.value)}
								leftIcon={<Phone size={16} />}
							/>
						</>
					)}

					<Input
						id="login-email"
						name="email"
						type="email"
						label="Work Email"
						placeholder="user@example.com"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						required
						leftIcon={<Mail size={16} />}
					/>

					<Input
						id="login-password"
						name="password"
						type={showPassword ? "text" : "password"}
						label={
							mode === "signup" ? "Password (min. 12 characters)" : "Password"
						}
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

					{mode === "signup" && (
						<>
							<Input
								id="signup-confirm-password"
								name="confirmPassword"
								type={showPassword ? "text" : "password"}
								label="Confirm Password"
								placeholder="••••••••••••"
								minLength={12}
								value={confirmPassword}
								onChange={(e) => setConfirmPassword(e.target.value)}
								required
								leftIcon={<Lock size={16} />}
							/>
							<div className="login-role-notice">
								<CheckCircle2
									size={15}
									className="text-primary flex-shrink-0"
								/>
								<span>
									Roles are assigned by an administrator. Newly created accounts
									have standard requester access until upgraded.
								</span>
							</div>
						</>
					)}

					<Button
						type="submit"
						variant="primary"
						size="lg"
						isLoading={loading}
						className="w-full mt-2"
					>
						{mode === "signup" ? "Create Account" : "Sign In"}
					</Button>

					<p className="text-sm text-center mt-3 text-secondary">
						{mode === "signup" ? (
							<>
								Already have an account?{" "}
								<button
									type="button"
									className="link-button font-semibold"
									onClick={() => switchMode("signin")}
								>
									Sign in
								</button>
							</>
						) : (
							<>
								Don&apos;t have an account?{" "}
								<button
									type="button"
									className="link-button font-semibold"
									onClick={() => switchMode("signup")}
								>
									Create an account
								</button>
							</>
						)}
					</p>
				</form>
			</div>
		</div>
	);
}
