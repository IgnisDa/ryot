import { describe, expect, it } from "bun:test";
import type { AppSavedView } from "#/features/saved-views/model";
import { createTrackerFixture } from "#/features/trackers/test-fixtures";
import type { SidebarTracker } from "./Sidebar.types";
import { toSidebarData } from "./sidebar-data";

const displayConfiguration: AppSavedView["displayConfiguration"] = {
	table: { columns: [{ property: ["@name"] }] },
	grid: {
		badgeProperty: null,
		subtitleProperty: null,
		titleProperty: ["@name"],
		imageProperty: ["@image"],
	},
	list: {
		badgeProperty: null,
		subtitleProperty: null,
		titleProperty: ["@name"],
		imageProperty: ["@image"],
	},
};

function createSavedViewFixture(
	overrides: Partial<AppSavedView>,
): AppSavedView {
	return {
		id: "view-1",
		isBuiltin: true,
		icon: "book-open",
		displayConfiguration,
		trackerId: "tracker-1",
		accentColor: "#5B7FFF",
		name: "Currently Reading",
		createdAt: "2026-03-20T10:00:00.000Z",
		updatedAt: "2026-03-20T10:05:00.000Z",
		queryDefinition: {
			filters: [],
			entitySchemaSlugs: ["schema-1"],
			sort: { field: ["@name"], direction: "asc" },
		},
		...overrides,
	};
}

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
				enabled: false,
			}),
		];
		const views: AppSavedView[] = [
			createSavedViewFixture({}),
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
					sort: { field: ["@name"], direction: "asc" },
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
				enabled: true,
				isBuiltin: false,
				accentColor: "#5B7FFF",
				views: [
					{
						id: "view-1",
						icon: "book-open",
						trackerSlug: "media",
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
				enabled: true,
				name: "Fitness",
				slug: "fitness",
				isBuiltin: false,
				icon: "dumbbell",
				accentColor: "#2DD4BF",
			},
		] as SidebarTracker[];

		expect(result.trackers).toEqual(expectedTrackers);
		expect(result.views).toEqual([
			{
				id: "view-2",
				trackerId: null,
				trackerSlug: null,
				icon: "sparkles",
				name: "Favorites",
				accentColor: "#2DD4BF",
			},
		]);
	});

	it("includes disabled trackers while customizing", () => {
		const trackers = [
			createTrackerFixture({
				sortOrder: 2,
				id: "tracker-2",
				name: "Hidden",
				slug: "hidden",
				enabled: false,
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
			isCustomizeMode: true,
		});

		expect(result.trackers.map((tracker) => tracker.id)).toEqual([
			"tracker-1",
			"tracker-2",
		]);
		expect(result.trackers[1]?.enabled).toBe(false);
	});
});
