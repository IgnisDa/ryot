import { usePlatformStoredValue } from "@/lib/atoms";

import type { SavedViewLayout } from "./runtime";

function createSavedViewLayoutStorageKey(viewSlug: string) {
	return `saved-view-layout:${viewSlug}`;
}

export function useSavedViewLayout(viewSlug: string) {
	const [layout, setLayout] = usePlatformStoredValue<SavedViewLayout>(
		createSavedViewLayoutStorageKey(viewSlug),
		"grid",
	);
	return { layout, setLayout };
}
