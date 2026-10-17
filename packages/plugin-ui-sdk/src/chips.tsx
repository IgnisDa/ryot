import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";

const chipClassName = (checked: boolean) =>
	clsx(
		"flex h-7 items-center justify-center gap-1.5 rounded-pill border px-3 text-xs font-medium pointer-coarse:h-9",
		checked
			? "border-accent-border bg-accent-soft text-accent-text"
			: "border-border-emphasis text-text-muted",
	);

type ChipProps = {
	readonly label: string;
	readonly checked: boolean;
	readonly className?: string | undefined;
};

export function Chip({ label, checked, className }: ChipProps) {
	return <span className={clsx(chipClassName(checked), className)}>{label}</span>;
}

export function ChipButton({
	icon,
	pressed,
	children,
	className,
	type = "button",
	...props
}: Omit<ComponentProps<"button">, "aria-pressed"> & {
	readonly icon?: ReactNode | undefined;
	readonly pressed?: boolean | undefined;
}) {
	return (
		<button
			type={type}
			aria-pressed={pressed}
			className={clsx(
				chipClassName(pressed === true),
				"whitespace-nowrap transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
				pressed !== true && "hover:border-border-strong hover:text-text",
				className,
			)}
			{...props}
		>
			{icon === undefined ? null : (
				<span aria-hidden="true" className="-ml-0.5 flex">
					{icon}
				</span>
			)}
			{children}
		</button>
	);
}
