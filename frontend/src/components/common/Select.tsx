import { forwardRef, type ReactNode, type SelectHTMLAttributes } from "react";

export interface Option {
	value: string;
	label: string;
	disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
	label?: string;
	error?: string;
	helperText?: string;
	options?: Option[];
	children?: ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
	(
		{
			label,
			error,
			helperText,
			options,
			children,
			className = "",
			id,
			...props
		},
		ref,
	) => {
		const selectId = id || props.name || undefined;

		return (
			<div className="form-group">
				{label && (
					<label htmlFor={selectId} className="form-label">
						{label}
						{props.required && <span className="text-danger ml-1">*</span>}
					</label>
				)}
				<div className="select-wrapper">
					<select
						ref={ref}
						id={selectId}
						className={`form-select ${error ? "input-error" : ""} ${className}`}
						{...props}
					>
						{options
							? options.map((opt) => (
									<option
										key={opt.value}
										value={opt.value}
										disabled={opt.disabled}
									>
										{opt.label}
									</option>
								))
							: children}
					</select>
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

Select.displayName = "Select";
