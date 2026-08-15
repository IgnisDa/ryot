import clsx from "clsx";
import { Pressable, Text, View } from "react-native";

export type AppMenuItem = {
	readonly label: string;
	readonly disabled?: boolean;
	readonly onPress?: () => void;
	readonly isDestructive?: boolean;
};

export function AppMenuItemRow(props: {
	readonly item: AppMenuItem;
	readonly onSelect: () => void;
}) {
	const disabled = props.item.disabled ?? false;
	return (
		<Pressable
			disabled={disabled}
			accessibilityRole="menuitem"
			accessibilityState={{ disabled }}
			accessibilityLabel={props.item.label}
			onPress={() => {
				props.onSelect();
				props.item.onPress?.();
			}}
			className={clsx(
				"min-h-11 justify-center rounded-lg px-3 py-2.5 focus-visible:outline-2 focus-visible:outline-accent",
				disabled && "opacity-50",
			)}
		>
			<Text
				className={clsx(
					"font-ui text-[15px]",
					props.item.isDestructive ? "text-danger" : "text-text",
				)}
			>
				{props.item.label}
			</Text>
		</Pressable>
	);
}

export function AppMenuNote(props: { readonly note: string }) {
	return (
		<View className="border-t border-border px-3 pb-1 pt-2.5">
			<Text className="font-ui text-xs text-text-subtle">{props.note}</Text>
		</View>
	);
}

export const rowActionMenuLabel = (subject: string) => `Actions for ${subject}`;
