import { useLocalSearchParams } from "expo-router";

import { NavigationPlaceholder } from "@/modules/navigation/navigation-placeholder";

export default function EntityPlaceholder() {
	const { entityId } = useLocalSearchParams<{ entityId: string }>();

	// TODO: Replace this placeholder with the entity screen and backend data.
	return (
		<NavigationPlaceholder detail="The selected entity will be rendered here." title={entityId} />
	);
}
