import { ChildScreenFrame } from "@/modules/navigation/child-screen-frame";
import { UserSettingsScreen } from "@/modules/user-settings/user-settings-screen";

export default function Settings() {
	return (
		<ChildScreenFrame title="Settings">
			<UserSettingsScreen />
		</ChildScreenFrame>
	);
}
