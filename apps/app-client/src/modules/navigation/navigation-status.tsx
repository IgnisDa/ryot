import { Text, View } from "react-native";

export function NavigationStatus(props: { detail?: string; title: string }) {
	return (
		<View className="flex-1 items-center justify-center gap-2 bg-bg px-6">
			<Text className="font-ui-medium text-base text-text">{props.title}</Text>
			{props.detail && (
				<Text className="max-w-xl text-center font-ui text-sm text-text-muted">{props.detail}</Text>
			)}
		</View>
	);
}
