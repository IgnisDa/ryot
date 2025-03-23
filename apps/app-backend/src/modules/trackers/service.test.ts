import { describe, expect, it } from "bun:test";
import {
	createListedTracker,
	createReorderTrackersBody,
	createTrackerBody,
	createTrackerDeps,
	createUpdateTrackerBody,
} from "~/lib/test-fixtures";
import { expectDataResult } from "~/lib/test-helpers";
import {
	buildTrackerOrder,
	createTracker,
	reorderTrackers,
	resolveTrackerPatch,
	updateTracker,
} from "./service";

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
			input: { isDisabled: false, description: "Default media tracker" },
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
			input: { isDisabled: false, name: "Whiskey Notes" },
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
			input: { isDisabled: false, description: "Track media" },
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
			input: { isDisabled: false, icon: "camera", description: "Track media" },
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
		const deps = createTrackerDeps({
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
			createTrackerDeps({
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
	it("updates isDisabled-only changes through a single repository call", async () => {
		const updatedTracker = expectDataResult(
			await updateTracker(
				{
					userId: "user_1",
					trackerId: "tracker_1",
					body: { isDisabled: true },
				},
				createTrackerDeps(),
			),
		);

		expect(updatedTracker.isDisabled).toBe(true);
	});

	it("updates isDisabled and config fields atomically through a single repository call", async () => {
		let updateCallCount = 0;
		const updatedTracker = expectDataResult(
			await updateTracker(
				{
					userId: "user_1",
					trackerId: "tracker_1",
					body: {
						isDisabled: true,
						icon: "book",
						name: "Books",
						accentColor: "#FF0000",
					},
				},
				createTrackerDeps({
					updateTrackerForUser: async (input) => {
						updateCallCount++;
						return createListedTracker({
							icon: input.icon,
							name: input.name,
							id: input.trackerId,
							isDisabled: input.isDisabled,
							accentColor: input.accentColor,
						});
					},
				}),
			),
		);

		expect(updateCallCount).toBe(1);
		expect(updatedTracker.isDisabled).toBe(true);
		expect(updatedTracker.name).toBe("Books");
	});

	it("returns not found when the tracker does not exist", async () => {
		const result = await updateTracker(
			{
				userId: "user_1",
				trackerId: "tracker_1",
				body: createUpdateTrackerBody(),
			},
			createTrackerDeps({ getOwnedTrackerById: async () => undefined }),
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Tracker not found",
		});
	});

	it("returns validation for a blank tracker id", async () => {
		const result = await updateTracker(
			{
				userId: "user_1",
				trackerId: "   ",
				body: { isDisabled: true },
			},
			createTrackerDeps(),
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
				createTrackerDeps(),
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
			createTrackerDeps({ countVisibleTrackersByIdsForUser: async () => 1 }),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Tracker ids contain unknown trackers",
		});
	});
});
