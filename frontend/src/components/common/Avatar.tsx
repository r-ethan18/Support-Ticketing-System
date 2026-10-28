interface AvatarProps {
	name: string;
	size?: "sm" | "md" | "lg";
	className?: string;
}

export function Avatar({ name, size = "md", className = "" }: AvatarProps) {
	const getInitials = (str: string) => {
		const parts = str.trim().split(" ");
		if (parts.length >= 2) {
			return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
		}
		return str.slice(0, 2).toUpperCase();
	};

	// Consistent color hashing
	const getBgColor = (str: string) => {
		const colors = [
			"#4f46e5", // Indigo
			"#0891b2", // Cyan
			"#059669", // Emerald
			"#d97706", // Amber
			"#7c3aed", // Violet
			"#db2777", // Pink
			"#2563eb", // Blue
		];
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			hash = str.charCodeAt(i) + ((hash << 5) - hash);
		}
		return colors[Math.abs(hash) % colors.length];
	};

	const initials = getInitials(name || "User");
	const bgColor = getBgColor(name || "User");

	return (
		<div
			role="img"
			className={`avatar avatar-${size} ${className}`}
			style={{ backgroundColor: bgColor }}
			title={name}
			aria-label={name}
		>
			<span>{initials}</span>
		</div>
	);
}
