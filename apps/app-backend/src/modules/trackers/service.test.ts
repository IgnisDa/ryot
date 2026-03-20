import { describe, expect, it } from "bun:test";
import { expectDataResult } from "~/lib/test-helpers";
import type {
	CreateTrackerBody,
	ListedTracker,
	ReorderTrackersBody,
	UpdateTrackerBody,
} from "./schemas";
import {
	buildTrackerOrder,
	createTracker,
	reorderTrackers,
	resolveTrackerPatch,
	type TrackerServiceDeps,
	updateTracker,
} from "./service";

const createListedTracker = (
	overrides: Partial<ListedTracker> = {},
): ListedTracker => ({
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
	...overrides,
});

const createOwnedTracker = (
	overrides: Partial<{
		id: string;
		icon: string;
		name: string;
		slug: string;
		accentColor: string;
		description: string | null;
	}> = {},
) => ({
	icon: "film",
	slug: "media",
	name: "Media",
	id: "tracker_1",
	description: null,
	accentColor: "#5B7FFF",
	...overrides,
});

const createTrackerBody = (): CreateTrackerBody => ({
	icon: "film",
	name: "Media",
	accentColor: "#5B7FFF",
	description: "Track media",
});

const createUpdateTrackerBody = (): UpdateTrackerBody => ({
	icon: "film",
	name: "Media",
	isDisabled: false,
	accentColor: "#5B7FFF",
	description: "Track media",
});

const createReorderTrackersBody = (): ReorderTrackersBody => ({
	trackerIds: ["tracker_2", "tracker_1"],
});

const createDeps = (
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
	setTrackerIsDisabledForUser: async (input) =>
		createListedTracker({ isDisabled: input.isDisabled, id: input.trackerId }),
	updateTrackerForUser: async (input) =>
		createListedTracker({
			icon: input.icon,
			name: input.name,
			slug: input.slug,
			id: input.trackerId,
			description: input.description,
			accentColor: input.accentColor,
		}),
	...overrides,
});

describe("resolveTrackerPatch", () => {
	it("keeps current slug when neither name nor slug changes", () => {
		const patch = resolveTrackerPatch({
			current: {
				icon: "film",
				slug: "media",
				name: "Media",
				description: null,
				accentColor: "#5B7FFF",
			},
			input: { description: "Default media tracker" },
		});

		expect(patch.slug).toBe("media");
		expect(patch.description).toBe("Default media tracker");
	});

	it("keeps current slug even when name changes", () => {
		const patch = resolveTrackerPatch({
			current: {
				icon: "coffee",
				slug: "whiskey",
				name: "Whiskey",
				description: null,
				accentColor: "#D4A574",
			},
			input: { name: "Whiskey Notes" },
		});

		expect(patch.slug).toBe("whiskey");
		expect(patch.name).toBe("Whiskey Notes");
	});

	it("keeps the current icon when icon is omitted", () => {
		const patch = resolveTrackerPatch({
			current: {
				icon: "film",
				slug: "media",
				name: "Media",
				description: null,
				accentColor: "#5B7FFF",
			},
			input: { description: "Track media" },
		});

		expect(patch.icon).toBe("film");
	});

	it("keeps the current accent color when accentColor is omitted", () => {
		const patch = resolveTrackerPatch({
			current: {
				icon: "film",
				slug: "media",
				name: "Media",
				description: null,
				accentColor: "#5B7FFF",
			},
			input: { icon: "camera", description: "Track media" },
		});

		expect(patch.accentColor).toBe("#5B7FFF");
	});
});

describe("buildTrackerOrder", () => {
	it("keeps unspecified trackers after requested order", () => {
		const nextOrder = buildTrackerOrder({
			currentTrackerIds: ["a", "b", "c", "d"],
			requestedTrackerIds: ["c", "a"],
		});

		expect(nextOrder).toEqual(["c", "a", "b", "d"]);
	});

	it("supports new trackers in requested order", () => {
		const nextOrder = buildTrackerOrder({
			currentTrackerIds: ["a", "b"],
			requestedTrackerIds: ["x", "b"],
		});

		expect(nextOrder).toEqual(["x", "b", "a"]);
	});
});

describe("createTracker", () => {
	it("normalizes the slug before persisting", async () => {
		let createdSlug: string | undefined;
		const deps = createDeps({
			createTrackerForUser: async (input) => {
				createdSlug = input.slug;
				return createListedTracker({ slug: input.slug, name: input.name });
			},
		});

		const createdTracker = expectDataResult(
			await createTracker(
				{
					userId: "user_1",
					body: { ...createTrackerBody(), slug: "  My_Custom Tracker  " },
				},
				deps,
			),
		);

		expect(createdSlug).toBe("my-custom-tracker");
		expect(createdTracker.slug).toBe("my-custom-tracker");
	});

	it("returns validation when the slug already exists", async () => {
		const result = await createTracker(
			{ body: createTrackerBody(), userId: "user_1" },
			createDeps({
				getTrackerBySlugForUser: async () => ({ id: "tracker_2" }),
			}),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Tracker slug already exists",
		});
	});
});

describe("updateTracker", () => {
	it("updates isDisabled-only changes through the dedicated repository path", async () => {
		const updatedTracker = expectDataResult(
			await updateTracker(
				{
					userId: "user_1",
					trackerId: "tracker_1",
					body: { isDisabled: true },
				},
				createDeps(),
			),
		);

		expect(updatedTracker.isDisabled).toBe(true);
	});

	it("returns not found when the tracker does not exist", async () => {
		const result = await updateTracker(
			{
				userId: "user_1",
				trackerId: "tracker_1",
				body: createUpdateTrackerBody(),
			},
			createDeps({ getOwnedTrackerById: async () => undefined }),
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Tracker not found",
		});
	});

	it("returns validation when no update fields are provided", async () => {
		const result = await updateTracker(
			{ body: {}, userId: "user_1", trackerId: "tracker_1" },
			createDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: "At least one field must be provided",
		});
	});

	it("returns validation for a blank tracker id", async () => {
		const result = await updateTracker(
			{
				userId: "user_1",
				trackerId: "   ",
				body: { isDisabled: true },
			},
			createDeps(),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Tracker id is required",
		});
	});
});

describe("reorderTrackers", () => {
	it("keeps unspecified trackers after the requested order", async () => {
		const reordered = expectDataResult(
			await reorderTrackers(
				{ body: createReorderTrackersBody(), userId: "user_1" },
				createDeps(),
			),
		);

		expect(reordered.trackerIds).toEqual([
			"tracker_2",
			"tracker_1",
			"tracker_3",
		]);
	});

	it("returns validation for unknown tracker ids", async () => {
		const result = await reorderTrackers(
			{ body: createReorderTrackersBody(), userId: "user_1" },
			createDeps({ countVisibleTrackersByIdsForUser: async () => 1 }),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Tracker ids contain unknown trackers",
		});
	});
});
