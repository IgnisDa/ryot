import { WorkspaceDetailFrame } from "@/modules/navigation/workspace-detail-frame";
import { SettingsScreen } from "@/modules/settings/settings-screen";

export default function Settings() {
	return (
		<WorkspaceDetailFrame title="Settings">
			<SettingsScreen />
		</WorkspaceDetailFrame>
	);
}
