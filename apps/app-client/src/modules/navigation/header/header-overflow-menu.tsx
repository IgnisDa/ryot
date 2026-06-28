import clsx from "clsx";
import { useEffect, useEffectEvent } from "react";
import { BackHandler, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HEADER_ROW_HEIGHT } from "./header-metrics";

export type HeaderOverflowItem = {
	label: string;
	isDestructive?: boolean;
};

export function HeaderOverflowMenu(props: {
	onClose: () => void;
	items: readonly HeaderOverflowItem[];
}) {
	const insets = useSafeAreaInsets();
	const close = useEffectEvent(() => props.onClose());

	useEffect(() => {
		if (Platform.OS !== "android") {
			return undefined;
		}
		const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
			close();
			return true;
		});
		return () => subscription.remove();
	}, []);

	return (
		<View className="absolute inset-0 z-40">
			<Pressable
				className="flex-1"
				onPress={props.onClose}
				accessibilityRole="button"
				accessibilityLabel="Close menu"
			/>
			<View
				style={{ top: insets.top + HEADER_ROW_HEIGHT - 4 }}
				className="absolute right-4 w-56 gap-0.5 rounded-xl border border-border bg-surface p-1.5 shadow-card"
			>
				{props.items.map((item) => (
					<Pressable
						key={item.label}
						onPress={props.onClose}
						accessibilityRole="menuitem"
						className="rounded-lg px-3 py-2.5"
					>
						<Text
							className={clsx(
								"font-ui text-[15px]",
								item.isDestructive ? "text-danger" : "text-text",
							)}
						>
							{item.label}
						</Text>
					</Pressable>
				))}
			</View>
		</View>
	);
}
