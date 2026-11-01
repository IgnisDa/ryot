import { type ReactNode, useMemo, useState } from "react";

import { IconButton } from "./button";
import { Menu, type MenuItem } from "./menu";

type MenuTrigger = {
	readonly onClick: () => void;
	readonly "aria-haspopup": "menu";
	readonly "aria-expanded": boolean;
	readonly ref: (element: null | HTMLButtonElement) => void;
};

export function MenuButton(props: {
	readonly label: string;
	readonly icon?: ReactNode;
	readonly disabled?: boolean;
	readonly items: ReadonlyArray<MenuItem>;
	readonly renderTrigger?: (trigger: MenuTrigger) => ReactNode;
}) {
	const [triggerElement, setTriggerElement] = useState<null | HTMLButtonElement>(null);
	const triggerRef = useMemo(() => ({ current: triggerElement }), [triggerElement]);
	const [open, setOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(0);
	const openMenu = () => {
		setActiveIndex(0);
		setOpen(true);
	};
	return (
		<>
			{props.renderTrigger === undefined ? (
				<IconButton
					size="sm"
					onClick={openMenu}
					label={props.label}
					aria-haspopup="menu"
					aria-expanded={open}
					ref={setTriggerElement}
					disabled={props.disabled}
				>
					{props.icon}
				</IconButton>
			) : (
				props.renderTrigger({
					onClick: openMenu,
					"aria-expanded": open,
					ref: setTriggerElement,
					"aria-haspopup": "menu",
				})
			)}
			{open ? (
				<Menu
					label={props.label}
					triggerRef={triggerRef}
					activeIndex={activeIndex}
					onActiveIndexChange={setActiveIndex}
					onClose={(restoreFocus) => {
						setOpen(false);
						if (restoreFocus) {
							triggerElement?.focus();
						}
					}}
					items={props.items.map((item) => ({
						...item,
						onSelect: () => {
							setOpen(false);
							item.onSelect();
						},
					}))}
				/>
			) : null}
		</>
	);
}
