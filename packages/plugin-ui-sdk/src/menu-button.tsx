import type { Text } from "@ryot-app/i18n/text";
import type { ReactElement, ReactNode, Ref } from "react";

import { IconButton } from "./button";
import { AppIcon } from "./icon";
import { Menu, type MenuItem } from "./menu";
import { ScreenBarButton } from "./screen-frame";

export function MenuButton({
	triggerRef,
	...props
}: {
	readonly label: Text;
	readonly icon?: ReactNode;
	readonly disabled?: boolean;
	readonly triggerElement?: ReactElement;
	readonly items: ReadonlyArray<MenuItem>;
	readonly trigger?: "bar" | "inline" | "toolbar";
	readonly triggerRef?: Ref<null | HTMLButtonElement>;
}) {
	const icon = props.icon ?? (
		<AppIcon name="more-horizontal" size={props.trigger === "bar" ? 22 : 16} />
	);
	const trigger =
		props.triggerElement ??
		(props.trigger === "bar" ? (
			<ScreenBarButton ref={triggerRef} label={props.label} disabled={props.disabled}>
				{icon}
			</ScreenBarButton>
		) : (
			<IconButton
				ref={triggerRef}
				label={props.label}
				disabled={props.disabled}
				size={props.trigger === "toolbar" ? "md" : "sm"}
				tone={props.trigger === "toolbar" ? "filled" : "ghost"}
			>
				{icon}
			</IconButton>
		));
	return <Menu trigger={trigger} label={props.label} items={props.items} />;
}
