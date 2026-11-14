import { type ReactNode, type Ref, useImperativeHandle, useMemo, useState } from "react";

import { IconButton } from "./button";
import { AppIcon } from "./icon";
import { Menu, type MenuItem } from "./menu";
import { ScreenBarButton } from "./screen-frame";

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
	readonly trigger?: "bar" | "inline" | "toolbar";
	readonly triggerRef?: Ref<null | HTMLButtonElement>;
	readonly renderTrigger?: (trigger: MenuTrigger) => ReactNode;
}) {
	const [triggerElement, setTriggerElement] = useState<null | HTMLButtonElement>(null);
	const triggerRef = useMemo(() => ({ current: triggerElement }), [triggerElement]);
	useImperativeHandle<null | HTMLButtonElement, null | HTMLButtonElement>(
		props.triggerRef,
		() => triggerElement,
		[triggerElement],
	);
	const [open, setOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(0);
	const openMenu = () => {
		setActiveIndex(0);
		setOpen(true);
	};
	const trigger: MenuTrigger = {
		onClick: openMenu,
		"aria-expanded": open,
		ref: setTriggerElement,
		"aria-haspopup": "menu",
	};
	const icon = props.icon ?? (
		<AppIcon name="more-horizontal" size={props.trigger === "bar" ? 22 : 16} />
	);
	let triggerNode: ReactNode;
	if (props.renderTrigger !== undefined) {
		triggerNode = props.renderTrigger(trigger);
	} else if (props.trigger === "bar") {
		triggerNode = (
			<ScreenBarButton {...trigger} label={props.label} disabled={props.disabled}>
				{icon}
			</ScreenBarButton>
		);
	} else {
		triggerNode = (
			<IconButton
				{...trigger}
				label={props.label}
				disabled={props.disabled}
				size={props.trigger === "toolbar" ? "md" : "sm"}
				tone={props.trigger === "toolbar" ? "filled" : "ghost"}
			>
				{icon}
			</IconButton>
		);
	}
	return (
		<>
			{triggerNode}
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
