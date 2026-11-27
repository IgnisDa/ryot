import clsx from "clsx";
import type { ComponentProps } from "react";

const tone = "inline-flex items-center gap-1.5 rounded-pill px-2 font-medium whitespace-nowrap";

const variantClasses = {
	info: `${tone} bg-info-soft text-info`,
	danger: `${tone} bg-danger-soft text-danger`,
	neutral: `${tone} bg-surface-2 text-text-muted`,
	success: `${tone} bg-success-soft text-success`,
	warning: `${tone} bg-warning-soft text-warning`,
	accent: `${tone} bg-accent-soft text-accent-text`,
	outline: `${tone} text-text-muted ring-1 ring-border-emphasis ring-inset`,
	count: "rounded-pill bg-accent-soft px-1.5 py-px text-micro text-accent-text tabular-nums",
} as const;

const toneSizeClasses = { md: "h-5.5 text-xs", sm: "h-4.5 px-1.5 text-micro" } as const;

type BadgeProps = ComponentProps<"span"> & {
	readonly dot?: boolean;
	readonly size?: keyof typeof toneSizeClasses;
	readonly variant?: keyof typeof variantClasses;
};

export function Badge({
	dot,
	children,
	className,
	size = "md",
	variant = "count",
	...props
}: BadgeProps) {
	return (
		<span
			className={clsx(
				variantClasses[variant],
				variant !== "count" && toneSizeClasses[size],
				className,
			)}
			{...props}
		>
			{dot === true && <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
			{children}
		</span>
	);
}
