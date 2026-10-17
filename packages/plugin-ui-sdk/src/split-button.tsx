import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";

import { Button } from "./button";
import type { MenuItem } from "./menu";
import { MenuButton } from "./menu-button";

const triggerClasses = {
	secondary: "bg-surface-2 text-text hover:bg-surface-3 border-border-emphasis",
	primary: "bg-accent text-accent-ink hover:bg-accent-hover border-accent-ink/20",
} as const;

export function SplitButton({
	items,
	menuIcon,
	menuLabel,
	className,
	variant = "primary",
	...props
}: Omit<ComponentProps<typeof Button>, "variant" | "size"> & {
	readonly menuIcon: ReactNode;
	readonly menuLabel: string;
	readonly items: ReadonlyArray<MenuItem>;
	readonly variant?: keyof typeof triggerClasses;
}) {
	return (
		<div className={clsx("inline-flex items-stretch", className)}>
			<Button {...props} variant={variant} className="rounded-r-none" />
			<MenuButton
				items={items}
				label={menuLabel}
				disabled={props.disabled === true || props.loading === true}
				renderTrigger={(trigger) => (
					<button
						type="button"
						{...trigger}
						aria-label={menuLabel}
						disabled={props.disabled === true || props.loading === true}
						className={clsx(
							"inline-flex min-h-9 w-9 items-center justify-center rounded-r-md border-l transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none pointer-coarse:min-h-11 pointer-coarse:w-11",
							triggerClasses[variant],
						)}
					>
						{menuIcon}
					</button>
				)}
			/>
		</div>
	);
}
