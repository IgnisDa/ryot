import { Switch } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import clsx from "clsx";
import { cloneElement, isValidElement, type ComponentProps, type ReactNode } from "react";

import type { CustomizeDraftItem } from "#/modules/navigation/customize/customize-state";

export function CustomizeRow(props: {
	readonly isLast: boolean;
	readonly handle: ReactNode;
	readonly item: CustomizeDraftItem;
	readonly readOnly?: boolean;
	readonly toggleDisabled?: boolean;
	readonly onToggle: (slug: string) => void;
}) {
	const muted = props.item.isDisabled ? "text-text-subtle" : "text-text";
	const handle =
		props.readOnly === true && isValidElement<ComponentProps<"button">>(props.handle)
			? cloneElement(props.handle, { disabled: true })
			: props.handle;
	return (
		<div
			className={clsx(
				"flex h-11 items-center gap-2 bg-raised px-1",
				!props.isLast && "border-b border-border",
			)}
		>
			{handle}
			<AppIcon size={17} name={props.item.icon} className={clsx("shrink-0", muted)} />
			<span className={clsx("min-w-0 flex-1 truncate text-sm", muted)}>{props.item.name}</span>
			<Switch
				checked={!props.item.isDisabled}
				label={`Show ${props.item.name} in sidebar`}
				onChange={() => props.onToggle(props.item.slug)}
				disabled={props.readOnly === true || props.toggleDisabled}
			/>
		</div>
	);
}

export function CustomizeHomeRow() {
	return (
		<div className="flex h-11 items-center gap-2 border-b border-border bg-raised px-1">
			<span aria-hidden="true" className="flex size-10 items-center justify-center opacity-40">
				<AppIcon size={18} name="grip-vertical" className="text-text-subtle" />
			</span>
			<AppIcon size={17} name="house" className="shrink-0 text-text" />
			<span className="min-w-0 flex-1 truncate text-sm text-text">Home</span>
			<span className="flex items-center gap-1.5 text-text-subtle">
				<AppIcon size={13} name="lock" />
				<span className="text-xs">Always shown</span>
			</span>
		</div>
	);
}
