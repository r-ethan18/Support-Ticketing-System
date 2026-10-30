import { Moon, Sun } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";

interface ThemeToggleProps {
	className?: string;
	showLabel?: boolean;
}

export function ThemeToggle({
	className = "",
	showLabel = false,
}: ThemeToggleProps) {
	const { theme, toggleTheme } = useTheme();

	return (
		<button
			type="button"
			onClick={toggleTheme}
			className={`theme-toggle-btn ${className}`}
			aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
			title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
		>
			{theme === "dark" ? (
				<Sun size={17} className="text-warning" />
			) : (
				<Moon size={17} className="text-slate" />
			)}
			{showLabel && (
				<span className="theme-toggle-label">
					{theme === "dark" ? "Light Mode" : "Dark Mode"}
				</span>
			)}
		</button>
	);
}
