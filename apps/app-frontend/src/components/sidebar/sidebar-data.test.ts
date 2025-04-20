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
		isDisabled: false,
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
				isDisabled: true,
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
				isDisabled: false,
				isBuiltin: false,
				accentColor: "#5B7FFF",
				views: [
					{
						id: "view-1",
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
		] as SidebarTracker[];

		expect(result.trackers).toEqual(expectedTrackers);
		expect(result.views).toEqual([
			{
				id: "view-2",
				trackerId: null,
				icon: "sparkles",
				isDisabled: false,
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
			isCustomizeMode: true,
		});

		expect(result.trackers.map((tracker) => tracker.id)).toEqual([
			"tracker-1",
			"tracker-2",
		]);
		expect(result.trackers[1]?.isDisabled).toBe(true);
	});

	it("hides disabled tracker views in normal mode", () => {
		const trackers = [
			createTrackerFixture({
				name: "Media",
				slug: "media",
				id: "tracker-1",
				accentColor: "#5B7FFF",
			}),
		];
		const views = [
			createSavedViewFixture({ id: "view-enabled", isDisabled: false }),
			createSavedViewFixture({ id: "view-disabled", isDisabled: true }),
		];

		const result = toSidebarData({ trackers, views });

		const mediaTracker = result.trackers.find((t) => t.id === "tracker-1");
		expect(mediaTracker?.views?.map((v) => v.id)).toEqual(["view-enabled"]);
	});

	it("includes disabled tracker views while customizing", () => {
		const trackers = [
			createTrackerFixture({
				name: "Media",
				slug: "media",
				id: "tracker-1",
				accentColor: "#5B7FFF",
			}),
		];
		const views = [
			createSavedViewFixture({ id: "view-enabled", isDisabled: false }),
			createSavedViewFixture({ id: "view-disabled", isDisabled: true }),
		];

		const result = toSidebarData({ trackers, views, isCustomizeMode: true });

		const mediaTracker = result.trackers.find((t) => t.id === "tracker-1");
		expect(mediaTracker?.views?.map((v) => v.id)).toEqual([
			"view-enabled",
			"view-disabled",
		]);
	});
});
