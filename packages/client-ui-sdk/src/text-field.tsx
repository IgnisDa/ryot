import clsx from "clsx";
import type { ComponentProps } from "react";

type FieldProps = {
	readonly invalid?: boolean | undefined;
	readonly density?: "compact" | "default" | undefined;
};

const fieldClassName = (
	{ invalid, density = "default" }: FieldProps,
	compactSpacing: string,
	className: string | undefined,
) =>
	clsx(
		"rounded-lg border border-border bg-raised text-text",
		density === "default" ? "px-4 py-3 text-base" : `${compactSpacing} text-base md:text-sm`,
		invalid === true && "border-danger",
		className,
	);

export function TextField({
	invalid,
	density,
	className,
	...props
}: ComponentProps<"input"> & FieldProps) {
	return (
		<input
			{...props}
			aria-invalid={invalid}
			className={fieldClassName({ invalid, density }, "h-10 px-3", className)}
		/>
	);
}

export function TextArea({
	invalid,
	density,
	className,
	...props
}: ComponentProps<"textarea"> & FieldProps) {
	return (
		<textarea
			{...props}
			aria-invalid={invalid}
			className={fieldClassName({ invalid, density }, "px-3 py-2", className)}
		/>
	);
}

export function FieldMessage({ className, ...props }: ComponentProps<"p">) {
	return <p role="alert" className={clsx("text-sm text-danger", className)} {...props} />;
}
