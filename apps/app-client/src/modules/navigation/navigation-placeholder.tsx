import { Text, View } from "react-native";

export function NavigationPlaceholder(props: { title: string; detail: string }) {
	return (
		<View className="w-full max-w-2xl gap-2 self-center rounded-xl border border-border bg-surface p-6">
			<Text className="font-display-semibold text-2xl text-text">{props.title}</Text>
			<Text className="font-ui text-sm text-text-muted">{props.detail}</Text>
		</View>
	);
}
