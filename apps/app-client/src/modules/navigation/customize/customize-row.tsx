import clsx from "clsx";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import { AppSwitch } from "@/modules/ui/switch";

import type { CustomizeDraftItem } from "./customize-state";

export function CustomizeRow(props: {
	handle: ReactNode;
	item: CustomizeDraftItem;
	onToggle: (slug: string) => void;
}) {
	return (
		<View className="h-11 flex-row items-center gap-2 px-1">
			{props.handle}
			<AppIcon
				size={17}
				name={props.item.icon}
				className={clsx(
					"shrink-0",
					props.item.isDisabled && "text-text-subtle",
					!props.item.isDisabled && "text-text",
				)}
			/>
			<Text
				className={clsx(
					"min-w-0 flex-1 font-ui text-sm",
					props.item.isDisabled && "text-text-subtle",
					!props.item.isDisabled && "text-text",
				)}
			>
				{props.item.name}
			</Text>
			<AppSwitch
				checked={!props.item.isDisabled}
				label={`Show ${props.item.name} in sidebar`}
				onChange={() => props.onToggle(props.item.slug)}
			/>
		</View>
	);
}

export function CustomizeHomeRow() {
	return (
		<View className="h-11 flex-row items-center gap-2 px-1">
			<View className="h-10 w-10" />
			<AppIcon className="shrink-0 text-text" name="house" size={17} />
			<Text className="min-w-0 flex-1 font-ui text-sm text-text">Home</Text>
			<View className="flex-row items-center gap-1.5">
				<AppIcon className="text-text-subtle" name="lock" size={13} />
				<Text className="font-ui text-xs text-text-subtle">Always shown</Text>
			</View>
		</View>
	);
}
