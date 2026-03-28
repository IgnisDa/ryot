import { NavigationPlaceholder } from "@/modules/navigation/navigation-placeholder";
import { WorkspaceDetailFrame } from "@/modules/navigation/workspace-detail-frame";

export default function SettingsPlaceholder() {
	// TODO: Replace this placeholder with account settings and backend preferences.
	return (
		<WorkspaceDetailFrame title="Settings">
			<NavigationPlaceholder detail="Account settings will be rendered here." title="Settings" />
		</WorkspaceDetailFrame>
	);
}
