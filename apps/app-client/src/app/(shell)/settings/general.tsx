import { SectionFrame } from "@/modules/ui/section-frame";
import { UserSettingsScreen } from "@/modules/user-settings/user-settings-screen";

export default function GeneralSettings() {
	return (
		<SectionFrame title="General">
			<UserSettingsScreen />
		</SectionFrame>
	);
}
