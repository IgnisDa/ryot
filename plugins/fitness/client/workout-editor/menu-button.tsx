import { IconButton, Menu, type MenuItem } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useMemo, useState, type ReactNode } from "react";

type MenuTrigger = {
	readonly "aria-haspopup": "menu";
	readonly "aria-expanded": boolean;
	readonly onClick: () => void;
	readonly ref: (element: HTMLButtonElement | null) => void;
};

export function MenuButton(props: {
	readonly label: string;
	readonly disabled?: boolean;
	readonly items: ReadonlyArray<MenuItem>;
	readonly renderTrigger?: (trigger: MenuTrigger) => ReactNode;
}) {
	const [triggerElement, setTriggerElement] = useState<HTMLButtonElement | null>(null);
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
					<AppIcon size={18} name="more-horizontal" />
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
