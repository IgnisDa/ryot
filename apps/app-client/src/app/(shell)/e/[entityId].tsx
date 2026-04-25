import { useLocalSearchParams } from "expo-router";

import { ShowScreen } from "@/modules/entity/show-screen";
import { NavigationStatus } from "@/modules/navigation/navigation-status";

export default function EntityDetails() {
	const { entityId } = useLocalSearchParams<{ entityId?: string | string[] }>();
	const normalizedEntityId = (Array.isArray(entityId) ? entityId[0] : entityId)?.trim();

	if (!normalizedEntityId) {
		return <NavigationStatus title="Show unavailable" detail="The show URL is invalid." />;
	}
	return <ShowScreen entityId={normalizedEntityId} />;
}
