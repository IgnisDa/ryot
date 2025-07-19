import { applyReorderPatch } from "~/lib/reorder";

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
	return applyReorderPatch(trackers, trackerIds);
}
