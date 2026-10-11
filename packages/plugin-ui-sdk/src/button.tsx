import clsx from "clsx";
import type { ComponentProps } from "react";

const variantClasses = {
	dangerGhost: "font-medium text-danger hover:bg-danger-soft",
	secondary: "bg-surface-2 font-medium text-text hover:bg-surface-3",
	ghost: "font-medium text-text-muted hover:bg-hover hover:text-text",
	primary: "bg-accent font-semibold text-accent-ink hover:bg-accent-hover",
	danger: "bg-danger-solid font-semibold text-danger-ink hover:opacity-90",
	outline: "border border-border-emphasis font-medium text-text hover:bg-hover",
	switch:
		"font-medium text-text-muted aria-pressed:bg-raised aria-pressed:text-text aria-pressed:shadow-sm",
	linkPlain:
		"font-ui font-medium text-[13px] text-text pointer-coarse:min-h-11 disabled:cursor-not-allowed disabled:opacity-50",
	link: "font-ui font-medium text-[13px] text-accent-text pointer-coarse:min-h-11 disabled:cursor-not-allowed disabled:opacity-50",
} as const;

const linkVariants: ReadonlySet<keyof typeof variantClasses> = new Set(["link", "linkPlain"]);

const sizeClasses = {
	md: "min-h-9 gap-2 rounded-md px-3.5 text-sm pointer-coarse:min-h-11",
	lg: "min-h-11 gap-2 rounded-md px-4.5 text-[15px] pointer-coarse:min-h-12",
	sm: "min-h-8 gap-1.5 rounded-sm px-2.5 text-[13px] pointer-coarse:min-h-10",
} as const;

type ButtonProps = ComponentProps<"button"> & {
	readonly loading?: boolean;
	readonly size?: keyof typeof sizeClasses;
	readonly variant?: keyof typeof variantClasses;
};

const buttonClassName = (
	variant: keyof typeof variantClasses = "primary",
	size: keyof typeof sizeClasses = "md",
) =>
	linkVariants.has(variant)
		? variantClasses[variant]
		: clsx(
				"relative inline-flex items-center justify-center py-1.5 leading-5 transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
				sizeClasses[size],
				variantClasses[variant],
			);

export function Button({
	loading,
	disabled,
	children,
	className,
	size = "md",
	variant = "primary",
	type = linkVariants.has(variant) ? "button" : undefined,
	...props
}: ButtonProps) {
	return (
		<button
			type={type}
			aria-busy={loading === true ? true : undefined}
			disabled={disabled === true || loading === true}
			className={clsx(buttonClassName(variant, size), className)}
			{...props}
		>
			{loading === true ? (
				<>
					<span className="inline-flex items-center gap-2 opacity-0">{children}</span>
					<span
						aria-hidden="true"
						className="absolute size-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-[spin_1.6s_linear_infinite]"
					/>
				</>
			) : (
				children
			)}
		</button>
	);
}

const iconToneClasses = {
	filled: "bg-surface-2 text-text hover:bg-surface-3",
	ghost: "text-text-muted hover:bg-hover hover:text-text",
	danger: "text-text-muted hover:bg-danger-soft hover:text-danger",
} as const;

const iconSizeClasses = {
	sm: "size-8 rounded-sm pointer-coarse:size-10",
	md: "size-9 rounded-md pointer-coarse:size-11",
} as const;

type IconButtonProps = Omit<ComponentProps<"button">, "aria-label"> & {
	readonly label: string;
	readonly tone?: keyof typeof iconToneClasses;
	readonly size?: keyof typeof iconSizeClasses;
};

export function IconButton({
	label,
	className,
	size = "md",
	tone = "ghost",
	type = "button",
	...props
}: IconButtonProps) {
	return (
		<button
			type={type}
			aria-label={label}
			className={clsx(
				"inline-flex shrink-0 items-center justify-center transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
				iconSizeClasses[size],
				iconToneClasses[tone],
				className,
			)}
			{...props}
		/>
	);
}
