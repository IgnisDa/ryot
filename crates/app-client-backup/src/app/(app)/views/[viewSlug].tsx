import { useLocalSearchParams } from "expo-router";

import { SavedViewScreen } from "@/features/saved-view";

export default function ViewScreen() {
	const { viewSlug: rawViewSlug } = useLocalSearchParams<"/(app)/views/[viewSlug]">();
	const viewSlug = Array.isArray(rawViewSlug) ? (rawViewSlug[0] ?? "") : rawViewSlug;

	return <SavedViewScreen viewSlug={viewSlug} />;
}
