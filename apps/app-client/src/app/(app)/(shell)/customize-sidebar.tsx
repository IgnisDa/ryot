import { CustomizeScreen } from "@/modules/navigation/customize/customize-screen";
import { WorkspaceNavigationLayout } from "@/modules/navigation/workspace-navigation-layout";

export default function CustomizeSidebar() {
	return (
		<WorkspaceNavigationLayout>
			{(navigation) => (
				<CustomizeScreen data={navigation.data} workspaceSlug={navigation.workspace.slug} />
			)}
		</WorkspaceNavigationLayout>
	);
}
