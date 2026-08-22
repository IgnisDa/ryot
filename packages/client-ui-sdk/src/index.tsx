import type { ComponentProps } from "react";

const variantClasses = {
	text: "min-h-10 cursor-pointer font-semibold text-text-muted",
	switch:
		"min-h-9.5 cursor-pointer rounded-md font-semibold text-text-muted aria-pressed:bg-raised aria-pressed:text-text aria-pressed:shadow-sm",
	primary:
		"min-h-11 cursor-pointer rounded-lg border border-accent bg-accent px-4 py-2.5 font-semibold text-accent-ink",
	secondary:
		"min-h-11 cursor-pointer rounded-lg border border-border-strong px-4 py-2.5 font-semibold text-text",
} as const;

type ButtonProps = ComponentProps<"button"> & {
	variant?: keyof typeof variantClasses;
};

export function Button({ className, variant = "primary", ...props }: ButtonProps) {
	return (
		<button className={[variantClasses[variant], className].filter(Boolean).join(" ")} {...props} />
	);
}

const toneClasses = {
	error: "text-danger",
	success: "text-success",
	pending: "text-text-muted",
} as const;

type StatusMessageProps = ComponentProps<"p"> & {
	tone: keyof typeof toneClasses;
};

export function StatusMessage({ className, tone, ...props }: StatusMessageProps) {
	return (
		<p
			role={tone === "error" ? "alert" : "status"}
			className={[toneClasses[tone], className].filter(Boolean).join(" ")}
			{...props}
		/>
	);
}
