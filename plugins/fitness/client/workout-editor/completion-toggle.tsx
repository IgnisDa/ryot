import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";

type CompletionToggleProps = Omit<
	ComponentProps<"button">,
	"role" | "children" | "aria-label" | "aria-checked" | "aria-pressed"
> & {
	readonly label: string;
	readonly icon: ReactNode;
	readonly pressed: boolean;
	readonly variant: "start" | "include" | "complete";
};

const press =
	"inline-flex shrink-0 items-center justify-center justify-self-end border-[1.5px] transition-[background-color,border-color,transform] duration-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transform-none motion-reduce:transition-none";

export function CompletionToggle({
	icon,
	label,
	variant,
	pressed,
	className,
	type = "button",
	...props
}: CompletionToggleProps) {
	if (variant === "include") {
		return (
			<button
				{...props}
				type={type}
				role="checkbox"
				aria-label={label}
				aria-checked={pressed}
				className={clsx(
					press,
					"size-6 rounded-sm pointer-coarse:size-7",
					pressed
						? "border-accent-deep bg-accent-deep text-surface"
						: "border-border-strong bg-surface text-transparent",
					className,
				)}
			>
				{icon}
			</button>
		);
	}
	return (
		<button
			{...props}
			type={type}
			aria-label={label}
			aria-pressed={variant === "complete" ? pressed : undefined}
			className={clsx(
				press,
				"size-9 rounded-md pointer-coarse:size-11",
				variant === "start" && "border-accent-deep text-accent-text hover:bg-accent-soft",
				variant === "complete" &&
					(pressed
						? "border-success bg-success text-surface"
						: "border-border-emphasis text-text-subtle hover:border-success hover:text-success"),
				className,
			)}
		>
			{icon}
		</button>
	);
}
