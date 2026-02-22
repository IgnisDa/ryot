import { Slot } from "expo-router";
import { View } from "react-native";

export default function WorkspaceLayout() {
	return (
		<View className="flex-1 bg-bg">
			<Slot />
		</View>
	);
}
