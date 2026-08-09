import { Slot } from "expo-router";

import { settingsSections } from "@/modules/settings/settings-sections";
import { SectionSidebarLayout } from "@/modules/ui/section-nav";

export default function SettingsLayout() {
	return (
		<SectionSidebarLayout title="Settings" fallbackSlug="preferences" sections={settingsSections}>
			<Slot />
		</SectionSidebarLayout>
	);
}
