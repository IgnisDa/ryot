import clsx from "clsx";

type ChipProps = {
	readonly label: string;
	readonly checked: boolean;
	readonly className?: string;
	readonly onSelect: () => void;
	readonly role: "radio" | "checkbox";
};

export function Chip({ role, label, checked, onSelect, className }: ChipProps) {
	return (
		<button
			role={role}
			type="button"
			onClick={onSelect}
			aria-label={label}
			aria-checked={checked}
			className={clsx(
				"flex h-7 items-center justify-center rounded-pill border px-3",
				checked ? "border-accent-border bg-accent-soft" : "border-border-strong",
				className,
			)}
		>
			<span
				className={clsx("text-xs font-medium", checked ? "text-accent-text" : "text-text-muted")}
			>
				{label}
			</span>
		</button>
	);
}
