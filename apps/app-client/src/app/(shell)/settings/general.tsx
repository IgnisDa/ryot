import { SettingsSectionFrame } from "@/modules/settings/settings-section-frame";
import { UserSettingsScreen } from "@/modules/user-settings/user-settings-screen";

export default function GeneralSettings() {
	return (
		<SettingsSectionFrame title="General">
			<UserSettingsScreen />
		</SettingsSectionFrame>
	);
}
