import { useLocalSearchParams } from "expo-router";

import { EntityDetailScreen } from "@/features/entity-detail";

export default function EntityDetailRoute() {
	const { entityId } = useLocalSearchParams<"/(app)/entity/[entityId]">();

	return <EntityDetailScreen entityId={entityId} />;
}
