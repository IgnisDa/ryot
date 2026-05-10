import { router, usePathname } from "expo-router";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { SettingsNavigationList } from "./settings-navigation-list";
import { getActiveSettingsSection, type SettingsSection } from "./settings-sections";

function navigate(section: SettingsSection) {
	router.replace(section.href);
}

export function SettingsDesktopLayout(props: { children: ReactNode }) {
	const pathname = usePathname();
	const active = getActiveSettingsSection(pathname);

	return (
		<View className="flex-1 flex-row bg-bg">
			<View className="hidden w-60 shrink-0 border-r border-border bg-surface px-4 py-8 md:flex">
				<Text className="mb-6 px-3 font-display-semibold text-2xl text-text">Settings</Text>
				<SettingsNavigationList active={active} showDisclosure={false} onSelect={navigate} />
			</View>
			<View className="min-w-0 flex-1">{props.children}</View>
		</View>
	);
}
