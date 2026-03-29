import type { ApiGetResponseData } from "#/lib/api/types";

export type AppTracker = ApiGetResponseData<"/trackers">[number];

export function sortTrackersByOrder(trackers: AppTracker[]): AppTracker[] {
	return [...trackers].sort((a, b) => {
		if (a.sortOrder !== b.sortOrder) {
			return a.sortOrder - b.sortOrder;
		}
		if (a.name !== b.name) {
			return a.name.localeCompare(b.name);
		}
		return a.slug.localeCompare(b.slug);
	});
}

export function selectEnabledTrackers(trackers: AppTracker[]): AppTracker[] {
	return trackers.filter((tracker) => tracker.enabled);
}

export function findEnabledTrackerBySlug(
	trackers: AppTracker[],
	slug: string,
): AppTracker | undefined {
	return trackers.find((tracker) => tracker.enabled && tracker.slug === slug);
}
