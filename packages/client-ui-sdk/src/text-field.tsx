import clsx from "clsx";
import type { ComponentProps } from "react";

type TextFieldProps = ComponentProps<"input"> & {
	readonly invalid?: boolean;
	readonly density?: "compact" | "default";
};

export function TextField({ invalid, className, density = "default", ...props }: TextFieldProps) {
	return (
		<input
			{...props}
			aria-invalid={invalid}
			className={clsx(
				"rounded-lg border border-border bg-raised text-text",
				density === "default" ? "px-4 py-3 text-base" : "h-10 px-3 text-base md:text-sm",
				invalid === true && "border-danger",
				className,
			)}
		/>
	);
}

export function FieldMessage({ className, ...props }: ComponentProps<"p">) {
	return <p role="alert" className={clsx("text-sm text-danger", className)} {...props} />;
}
