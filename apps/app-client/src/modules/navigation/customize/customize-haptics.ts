import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

export const customizeHaptics = {
	onDrop: () => {
		if (Platform.OS !== "web") {
			void Haptics.selectionAsync();
		}
	},
	onPickUp: () => {
		if (Platform.OS !== "web") {
			void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
		}
	},
};
