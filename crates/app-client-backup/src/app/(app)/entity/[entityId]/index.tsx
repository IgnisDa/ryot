import { useLocalSearchParams } from "expo-router";

import { EntityDetailScreen } from "@/features/entity-detail";

export default function EntityDetailRoute() {
	const { entityId: rawEntityId } = useLocalSearchParams<"/(app)/entity/[entityId]">();
	const entityId = Array.isArray(rawEntityId) ? (rawEntityId[0] ?? "") : rawEntityId;

	return <EntityDetailScreen entityId={entityId} />;
}
