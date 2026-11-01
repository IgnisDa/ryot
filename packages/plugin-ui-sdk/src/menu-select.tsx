import clsx from "clsx";
import { type ReactNode, useMemo, useState } from "react";

import { Menu } from "./menu";

type MenuSelectChoice<T extends string> = { readonly value: T; readonly label: string };

export function MenuSelect<T extends string>(props: {
	readonly value: T;
	readonly label: string;
	readonly disabled?: boolean;
	readonly className?: string;
	readonly checkIcon: ReactNode;
	readonly chevronIcon: ReactNode;
	readonly onChange: (value: T) => void;
	readonly choices: ReadonlyArray<MenuSelectChoice<T>>;
}) {
	const [trigger, setTrigger] = useState<null | HTMLButtonElement>(null);
	const triggerRef = useMemo(() => ({ current: trigger }), [trigger]);
	const [open, setOpen] = useState(false);
	const selectedIndex = Math.max(
		0,
		props.choices.findIndex((choice) => choice.value === props.value),
	);
	const [activeIndex, setActiveIndex] = useState(selectedIndex);
	const selected = props.choices[selectedIndex];
	return (
		<>
			<button
				type="button"
				ref={setTrigger}
				aria-haspopup="menu"
				aria-expanded={open}
				disabled={props.disabled}
				aria-label={`${props.label}: ${selected?.label ?? ""}`}
				onClick={() => {
					setActiveIndex(selectedIndex);
					setOpen(true);
				}}
				className={clsx(
					"inline-flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-label whitespace-nowrap shadow-sm transition-colors duration-100 hover:border-border-emphasis hover:bg-hover disabled:opacity-60 disabled:hover:bg-surface motion-reduce:transition-none pointer-coarse:h-11",
					props.className,
				)}
			>
				<span className="text-text-muted">{props.label}</span>
				<span className="truncate font-medium text-text">{selected?.label}</span>
				<span aria-hidden="true" className="shrink-0 text-text-muted">
					{props.chevronIcon}
				</span>
			</button>
			{open ? (
				<Menu
					label={props.label}
					triggerRef={triggerRef}
					activeIndex={activeIndex}
					checkIcon={props.checkIcon}
					onActiveIndexChange={setActiveIndex}
					onClose={(restoreFocus) => {
						setOpen(false);
						if (restoreFocus) {
							trigger?.focus();
						}
					}}
					items={props.choices.map((choice) => ({
						key: choice.value,
						label: choice.label,
						checked: choice.value === props.value,
						onSelect: () => {
							setOpen(false);
							trigger?.focus();
							props.onChange(choice.value);
						},
					}))}
				/>
			) : null}
		</>
	);
}
