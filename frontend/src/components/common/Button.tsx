import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
	size?: "sm" | "md" | "lg";
	isLoading?: boolean;
	icon?: ReactNode;
	children: ReactNode;
}

export function Button({
	variant = "primary",
	size = "md",
	isLoading = false,
	icon,
	children,
	className = "",
	disabled,
	...props
}: ButtonProps) {
	return (
		<button
			className={`btn btn-${variant} btn-${size} ${className}`}
			disabled={disabled || isLoading}
			{...props}
		>
			{isLoading ? (
				<Loader2 className="btn-spinner animate-spin" size={16} />
			) : (
				icon && <span className="btn-icon">{icon}</span>
			)}
			<span>{children}</span>
		</button>
	);
}
