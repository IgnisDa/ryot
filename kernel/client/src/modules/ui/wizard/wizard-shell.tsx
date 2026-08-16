import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";

export function WizardShell(props: {
	readonly title: string;
	readonly stepLabel: string;
	readonly closeLabel: string;
	readonly onClose: () => void;
	readonly children: ReactNode;
}) {
	return (
		<View className="flex-1">
			<View className="gap-1 border-b border-border px-4 py-3">
				<View className="flex-row items-center justify-between gap-3">
					<Text accessibilityRole="header" className="font-display-semibold text-xl text-text">
						{props.title}
					</Text>
					<Pressable
						className="p-1"
						onPress={props.onClose}
						accessibilityRole="button"
						accessibilityLabel={props.closeLabel}
					>
						<AppIcon size={20} name="x" className="text-text-muted" />
					</Pressable>
				</View>
				<Text className="font-ui text-xs text-text-subtle">{props.stepLabel}</Text>
			</View>
			<ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
				<View className="gap-4 p-4">{props.children}</View>
			</ScrollView>
		</View>
	);
}
