import { describe, expect, it } from "bun:test";
import type { AppSavedView } from "#/features/saved-views/model";
import { createSavedViewFixture } from "#/features/test-fixtures";
import { createTrackerFixture } from "#/features/trackers/test-fixtures";
import type { SidebarTracker } from "./Sidebar.types";
import { toSidebarData } from "./sidebar-data";

describe("toSidebarData", () => {
	it("maps live trackers and saved views to sidebar data", () => {
		const trackers = [
			createTrackerFixture({
				sortOrder: 2,
				id: "tracker-2",
				name: "Fitness",
				slug: "fitness",
				icon: "dumbbell",
				accentColor: "#2DD4BF",
			}),
			createTrackerFixture({
				icon: "film",
				sortOrder: 1,
				id: "tracker-1",
				name: "Media",
				slug: "media",
				accentColor: "#5B7FFF",
			}),
			createTrackerFixture({
				sortOrder: 3,
				id: "tracker-3",
				name: "Hidden",
				slug: "hidden",
				isDisabled: true,
			}),
		];
		const views: AppSavedView[] = [
			createSavedViewFixture({
				name: "Currently Reading",
			}),
			createSavedViewFixture({
				id: "view-2",
				trackerId: null,
				icon: "sparkles",
				isBuiltin: false,
				name: "Favorites",
				accentColor: "#2DD4BF",
				queryDefinition: {
					filters: [],
					entitySchemaSlugs: ["schema-2"],
					sort: { fields: ["entity.schema-2.@name"], direction: "asc" },
				},
			}),
		];

		const result = toSidebarData({ trackers, views });
		const expectedTrackers = [
			{
				icon: "film",
				sortOrder: 1,
				id: "tracker-1",
				name: "Media",
				slug: "media",
				isDisabled: false,
				isBuiltin: false,
				accentColor: "#5B7FFF",
				views: [
					{
						id: "view-1",
						sortOrder: 1,
						isBuiltin: true,
						icon: "book-open",
						isDisabled: false,
						trackerId: "tracker-1",
						accentColor: "#5B7FFF",
						name: "Currently Reading",
					},
				],
			},
			{
				views: [],
				sortOrder: 2,
				id: "tracker-2",
				isDisabled: false,
				name: "Fitness",
				slug: "fitness",
				isBuiltin: false,
				icon: "dumbbell",
				accentColor: "#2DD4BF",
			},
			{
				views: [],
				sortOrder: 3,
				icon: "shapes",
				name: "Hidden",
				slug: "hidden",
				id: "tracker-3",
				isBuiltin: false,
				isDisabled: true,
				accentColor: "#5B7FFF",
			},
		] as SidebarTracker[];

		expect(result.trackers).toEqual(expectedTrackers);
		expect(result.views).toEqual([
			{
				id: "view-2",
				sortOrder: 1,
				trackerId: null,
				icon: "sparkles",
				isBuiltin: false,
				isDisabled: false,
				name: "Favorites",
				accentColor: "#2DD4BF",
			},
		]);
	});

	it("keeps disabled trackers provided by the caller", () => {
		const trackers = [
			createTrackerFixture({
				sortOrder: 2,
				id: "tracker-2",
				name: "Hidden",
				slug: "hidden",
				isDisabled: true,
				icon: "eye-off",
				accentColor: "#A78BFA",
			}),
			createTrackerFixture({
				sortOrder: 1,
				icon: "film",
				id: "tracker-1",
				name: "Media",
				slug: "media",
				accentColor: "#5B7FFF",
			}),
		];

		const result = toSidebarData({
			views: [],
			trackers,
		});

		expect(result.trackers.map((tracker) => tracker.id)).toEqual([
			"tracker-1",
			"tracker-2",
		]);
		expect(result.trackers[1]?.isDisabled).toBe(true);
	});

	it("keeps disabled tracker views provided by the caller", () => {
		const trackers = [
			createTrackerFixture({
				name: "Media",
				slug: "media",
				id: "tracker-1",
				accentColor: "#5B7FFF",
			}),
		];
		const views = [
			createSavedViewFixture({
				sortOrder: 1,
				isDisabled: false,
				id: "view-enabled",
			}),
			createSavedViewFixture({
				sortOrder: 2,
				isDisabled: true,
				id: "view-disabled",
			}),
		];

		const result = toSidebarData({ trackers, views });

		const mediaTracker = result.trackers.find((t) => t.id === "tracker-1");
		expect(mediaTracker?.views?.map((v) => v.id)).toEqual([
			"view-enabled",
			"view-disabled",
		]);
	});

	it("keeps standalone disabled views provided by the caller", () => {
		const trackers = [createTrackerFixture({ id: "tracker-1" })];
		const views = [
			createSavedViewFixture({
				sortOrder: 1,
				trackerId: null,
				isDisabled: false,
				id: "standalone-enabled",
			}),
			createSavedViewFixture({
				sortOrder: 2,
				trackerId: null,
				isDisabled: true,
				id: "standalone-disabled",
			}),
		];

		const result = toSidebarData({ trackers, views });

		expect(result.views.map((view) => view.id)).toEqual([
			"standalone-enabled",
			"standalone-disabled",
		]);
	});

	it("propagates isBuiltin from views to tracker-scoped sidebar views", () => {
		const trackers = [createTrackerFixture({ id: "tracker-1" })];
		const views = [
			createSavedViewFixture({ id: "view-builtin", isBuiltin: true }),
			createSavedViewFixture({
				sortOrder: 2,
				isBuiltin: false,
				id: "view-custom",
			}),
		];

		const result = toSidebarData({ trackers, views });

		const trackerViews = result.trackers[0]?.views ?? [];
		const builtinView = trackerViews.find((v) => v.id === "view-builtin");
		const customView = trackerViews.find((v) => v.id === "view-custom");

		expect(builtinView?.isBuiltin).toBe(true);
		expect(customView?.isBuiltin).toBe(false);
	});

	it("propagates isBuiltin from views to standalone sidebar views", () => {
		const trackers = [createTrackerFixture({ id: "tracker-1" })];
		const views = [
			createSavedViewFixture({
				sortOrder: 1,
				isBuiltin: true,
				trackerId: null,
				id: "standalone-builtin",
			}),
			createSavedViewFixture({
				sortOrder: 2,
				trackerId: null,
				isBuiltin: false,
				id: "standalone-custom",
			}),
		];

		const result = toSidebarData({ trackers, views });

		const builtinView = result.views.find((v) => v.id === "standalone-builtin");
		const customView = result.views.find((v) => v.id === "standalone-custom");

		expect(builtinView?.isBuiltin).toBe(true);
		expect(customView?.isBuiltin).toBe(false);
	});

	it("sorts views within each scope by ascending sortOrder", () => {
		const trackers = [createTrackerFixture({ id: "tracker-1" })];
		const views = [
			createSavedViewFixture({
				id: "view-3",
				sortOrder: 3,
				trackerId: "tracker-1",
			}),
			createSavedViewFixture({
				id: "view-1",
				sortOrder: 1,
				trackerId: "tracker-1",
			}),
			createSavedViewFixture({ id: "view-2", trackerId: null, sortOrder: 2 }),
			createSavedViewFixture({ id: "view-4", trackerId: null, sortOrder: 1 }),
		];

		const result = toSidebarData({ trackers, views });

		expect(result.trackers[0]?.views?.map((view) => view.id)).toEqual([
			"view-1",
			"view-3",
		]);
		expect(result.views.map((view) => view.id)).toEqual(["view-4", "view-2"]);
	});
});
