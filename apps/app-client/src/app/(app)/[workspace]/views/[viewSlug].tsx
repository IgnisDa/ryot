import { useLocalSearchParams } from "expo-router";

import { NavigationPlaceholder } from "@/modules/navigation/navigation-placeholder";

export default function ViewPlaceholder() {
	const { viewSlug } = useLocalSearchParams<{ viewSlug: string }>();

	// TODO: Replace this placeholder with the saved view screen and backend data.
	return (
		<NavigationPlaceholder detail="The selected view will be rendered here." title={viewSlug} />
	);
}
