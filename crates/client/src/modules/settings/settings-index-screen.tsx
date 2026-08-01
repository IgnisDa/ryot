import { router } from "expo-router";
import { View } from "react-native";

import { ChildScreenFrame } from "@/modules/navigation/child-screen-frame";
import { SectionNavList } from "@/modules/ui/section-nav";

import { settingsSections } from "./settings-sections";

export function SettingsIndexScreen() {
	return (
		<ChildScreenFrame title="Settings">
			<View className="w-full max-w-2xl self-center rounded-xl border border-border bg-surface p-2">
				<SectionNavList
					active={null}
					showDisclosure
					sections={settingsSections}
					onSelect={(section) => router.push(section.href)}
				/>
			</View>
		</ChildScreenFrame>
	);
}
