import { Slot } from "expo-router";

import { SettingsDesktopLayout } from "@/modules/settings/settings-desktop-layout";

export default function SettingsLayout() {
	return (
		<SettingsDesktopLayout>
			<Slot />
		</SettingsDesktopLayout>
	);
}
