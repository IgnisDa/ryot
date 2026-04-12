import { withOverrides } from "~/lib/test-fixtures/fixture-helpers";
import type {
	CreateTrackerBody,
	ListedTracker,
	ReorderTrackersBody,
	TrackerServiceDeps,
	UpdateTrackerBody,
} from "~/modules/trackers";

type OwnedTracker = NonNullable<
	Awaited<ReturnType<TrackerServiceDeps["getOwnedTrackerById"]>>
>;

const listedTrackerDefaults: ListedTracker = {
	config: null,
	icon: "film",
	sortOrder: 0,
	slug: "media",
	name: "Media",
	id: "tracker_1",
	isBuiltin: false,
	isDisabled: false,
	description: null,
	accentColor: "#5B7FFF",
};

const ownedTrackerDefaults: OwnedTracker = {
	icon: "film",
	slug: "media",
	name: "Media",
	id: "tracker_1",
	description: null,
	accentColor: "#5B7FFF",
};

const trackerBodyDefaults: CreateTrackerBody = {
	icon: "film",
	name: "Media",
	accentColor: "#5B7FFF",
	description: "Track media",
};

const updateTrackerBodyDefaults: UpdateTrackerBody = {
	icon: "film",
	name: "Media",
	isDisabled: false,
	accentColor: "#5B7FFF",
	description: "Track media",
};

const reorderTrackersBodyDefaults: ReorderTrackersBody = {
	trackerIds: ["tracker_2", "tracker_1"],
};

export const createListedTracker = (
	overrides: Partial<ListedTracker> = {},
): ListedTracker => withOverrides(listedTrackerDefaults, overrides);

export const createOwnedTracker = (
	overrides: Partial<OwnedTracker> = {},
): OwnedTracker => withOverrides(ownedTrackerDefaults, overrides);

export const createTrackerBody = (
	overrides: Partial<CreateTrackerBody> = {},
): CreateTrackerBody => withOverrides(trackerBodyDefaults, overrides);

export const createUpdateTrackerBody = (
	overrides: Partial<UpdateTrackerBody> = {},
): UpdateTrackerBody => withOverrides(updateTrackerBodyDefaults, overrides);

export const createReorderTrackersBody = (
	overrides: Partial<ReorderTrackersBody> = {},
): ReorderTrackersBody => withOverrides(reorderTrackersBodyDefaults, overrides);

export const createTrackerDeps = (
	overrides: Partial<TrackerServiceDeps> = {},
): TrackerServiceDeps => ({
	createTrackerForUser: async (input) =>
		createListedTracker({
			slug: input.slug,
			name: input.name,
			icon: input.icon,
			accentColor: input.accentColor,
			description: input.description ?? null,
		}),
	countVisibleTrackersByIdsForUser: async (input) => input.trackerIds.length,
	getOwnedTrackerById: async (input) =>
		createOwnedTracker({ id: input.trackerId }),
	getTrackerBySlugForUser: async () => undefined,
	listUserTrackerIdsInOrder: async () => [
		"tracker_1",
		"tracker_2",
		"tracker_3",
	],
	persistTrackerOrderForUser: async (input) => input.trackerIds,
	updateTrackerForUser: async (input) =>
		createListedTracker({
			icon: input.icon,
			name: input.name,
			slug: input.slug,
			id: input.trackerId,
			isDisabled: input.isDisabled,
			description: input.description,
			accentColor: input.accentColor,
		}),
	...overrides,
});
