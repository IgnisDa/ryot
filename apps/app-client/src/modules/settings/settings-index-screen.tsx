import { router } from "expo-router";
import { View } from "react-native";

import { ChildScreenFrame } from "@/modules/navigation/child-screen-frame";

import { SettingsNavigationList } from "./settings-navigation-list";
import type { SettingsSection } from "./settings-sections";

function navigate(section: SettingsSection) {
	router.push(section.href);
}

export function SettingsIndexScreen() {
	return (
		<ChildScreenFrame title="Settings">
			<View className="w-full max-w-2xl self-center rounded-xl border border-border bg-surface p-2">
				<SettingsNavigationList active={null} showDisclosure onSelect={navigate} />
			</View>
		</ChildScreenFrame>
	);
}
