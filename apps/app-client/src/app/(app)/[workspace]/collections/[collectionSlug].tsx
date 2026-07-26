import { useLocalSearchParams } from "expo-router";

import { NavigationPlaceholder } from "@/modules/navigation/navigation-placeholder";

export default function CollectionPlaceholder() {
	const { collectionSlug } = useLocalSearchParams<{ collectionSlug: string }>();

	// TODO: Replace this placeholder with the collection screen and backend data.
	return (
		<NavigationPlaceholder
			detail="The selected collection will be rendered here."
			title={collectionSlug}
		/>
	);
}
