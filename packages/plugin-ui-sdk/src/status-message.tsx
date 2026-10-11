import clsx from "clsx";
import type { ComponentProps } from "react";

const toneClasses = {
	error: "text-danger",
	success: "text-success",
	pending: "text-text-muted",
} as const;

type StatusMessageProps = ComponentProps<"p"> & { tone: keyof typeof toneClasses };

export function StatusMessage({ tone, className, ...props }: StatusMessageProps) {
	return (
		<p
			role={tone === "error" ? "alert" : "status"}
			className={clsx(toneClasses[tone], className)}
			{...props}
		/>
	);
}
