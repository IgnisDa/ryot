import clsx from "clsx";
import type { ComponentProps } from "react";

const variantClasses = {
	text: "min-h-10 font-semibold text-text-muted",
	secondary: "min-h-11 rounded-lg border border-border-strong px-4 py-2.5 font-semibold text-text",
	primary:
		"min-h-11 rounded-lg border border-accent-deep bg-accent px-4 py-2.5 font-semibold text-accent-ink",
	switch:
		"min-h-9.5 rounded-md font-semibold text-text-muted aria-pressed:bg-raised aria-pressed:text-text aria-pressed:shadow-sm",
} as const;

type ButtonProps = ComponentProps<"button"> & { variant?: keyof typeof variantClasses };

export function Button({ className, variant = "primary", ...props }: ButtonProps) {
	return <button className={clsx(variantClasses[variant], className)} {...props} />;
}
