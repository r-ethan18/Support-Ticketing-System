import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
	label?: string;
	error?: string;
	helperText?: string;
	leftIcon?: ReactNode;
	rightElement?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
	(
		{
			label,
			error,
			helperText,
			leftIcon,
			rightElement,
			className = "",
			id,
			...props
		},
		ref,
	) => {
		const inputId = id || props.name || undefined;

		return (
			<div className="form-group">
				{label && (
					<label htmlFor={inputId} className="form-label">
						{label}
						{props.required && <span className="text-danger ml-1">*</span>}
					</label>
				)}
				<div className="input-wrapper">
					{leftIcon && <span className="input-left-icon">{leftIcon}</span>}
					<input
						ref={ref}
						id={inputId}
						className={`form-input ${leftIcon ? "has-left-icon" : ""} ${
							rightElement ? "has-right-element" : ""
						} ${error ? "input-error" : ""} ${className}`}
						{...props}
					/>
					{rightElement && (
						<div className="input-right-element">{rightElement}</div>
					)}
				</div>
				{error ? (
					<p className="form-error">{error}</p>
				) : helperText ? (
					<p className="form-helper">{helperText}</p>
				) : null}
			</div>
		);
	},
);

Input.displayName = "Input";
