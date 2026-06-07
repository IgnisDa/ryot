import { SectionFrame } from "@/modules/ui/section-frame";
import { PreferencesScreen } from "@/modules/user-settings/preferences-screen";

export default function PreferencesSettings() {
	return (
		<SectionFrame title="Preferences">
			<PreferencesScreen />
		</SectionFrame>
	);
}
