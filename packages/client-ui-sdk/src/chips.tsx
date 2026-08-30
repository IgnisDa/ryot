import clsx from "clsx";

type ChipProps = { readonly label: string; readonly checked: boolean; readonly className?: string };

export function Chip({ label, checked, className }: ChipProps) {
	return (
		<span
			className={clsx(
				"flex h-7 items-center justify-center rounded-pill border px-3 text-xs font-medium",
				checked
					? "border-accent-border bg-accent-soft text-accent-text"
					: "border-border-strong text-text-muted",
				className,
			)}
		>
			{label}
		</span>
	);
}
