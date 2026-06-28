import clsx from "clsx";
import type { ComponentProps } from "react";

const variantClasses = {
	count: "rounded-pill bg-accent-soft px-1.5 py-px text-[11px] text-accent-text",
	keyOnAccent:
		"rounded border border-accent-ink px-1.5 py-0.5 font-mono text-[11px] text-accent-ink",
	key: "rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-text-muted",
} as const;

type BadgeProps = ComponentProps<"span"> & { variant?: keyof typeof variantClasses };

export function Badge({ className, variant = "count", ...props }: BadgeProps) {
	return <span className={clsx(variantClasses[variant], className)} {...props} />;
}
