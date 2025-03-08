export const trackerNotFoundError = "Tracker not found";
export const customTrackerError =
	"Built-in trackers do not support entity schema creation";

type TrackerScope = {
	id: string;
	userId: string;
	isBuiltin: boolean;
};

export const resolveTrackerReadAccess = (tracker: TrackerScope | undefined) => {
	if (!tracker) return { error: "not_found" as const };
	return { tracker };
};

export const resolveCustomTrackerAccess = (
	tracker: TrackerScope | undefined,
) => {
	if (!tracker) return { error: "not_found" as const };
	if (tracker.isBuiltin) return { error: "builtin" as const };

	return { tracker };
};
