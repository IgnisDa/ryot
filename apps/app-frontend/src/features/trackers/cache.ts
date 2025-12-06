import type { AppTracker } from "./model";

export function applyTrackerIsDisabledPatch(
	trackers: AppTracker[],
	trackerId: string,
	isDisabled: boolean,
): AppTracker[] {
	return trackers.map((tracker) =>
		tracker.id === trackerId ? { ...tracker, isDisabled } : tracker,
	);
}

export function applyTrackerReorderPatch(
	trackers: AppTracker[],
	trackerIds: string[],
): AppTracker[] {
	const trackerMap = new Map(trackers.map((f) => [f.id, f]));
	const reordered: AppTracker[] = [];
	const seen = new Set<string>();

	for (const id of trackerIds) {
		const tracker = trackerMap.get(id);
		if (tracker) {
			reordered.push(tracker);
			seen.add(id);
		}
	}

	for (const tracker of trackers) {
		if (!seen.has(tracker.id)) {
			reordered.push(tracker);
		}
	}

	return reordered.map((tracker, index) => ({
		...tracker,
		sortOrder: index + 1,
	}));
}
