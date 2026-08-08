import { ChildScreenFrame } from "@/modules/navigation/child-screen-frame";
import { SettingsScreen } from "@/modules/settings/settings-screen";

export default function Settings() {
	return (
		<ChildScreenFrame title="Settings">
			<SettingsScreen />
		</ChildScreenFrame>
	);
}
