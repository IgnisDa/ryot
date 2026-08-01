import { useLocalSearchParams } from "expo-router";

import { NavigationPlaceholder } from "@/modules/navigation/navigation-placeholder";
import { WorkspaceDetailFrame } from "@/modules/navigation/workspace-detail-frame";

export default function EntityPlaceholder() {
	const { entityId } = useLocalSearchParams<{ entityId: string }>();

	// TODO: Replace this placeholder with the entity screen and backend data.
	return (
		<WorkspaceDetailFrame title={entityId}>
			<NavigationPlaceholder detail="The selected entity will be rendered here." title={entityId} />
		</WorkspaceDetailFrame>
	);
}
