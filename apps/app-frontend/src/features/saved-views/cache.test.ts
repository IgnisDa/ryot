import { describe, expect, it } from "bun:test";
import { applySavedViewReorderPatch } from "./cache";
import type { AppSavedView } from "./model";

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

function view(
	id: string,
	sortOrder: number,
	trackerId: string | null,
): AppSavedView {
	return {
		id,
		name: id,
		sortOrder,
		trackerId,
		isBuiltin: false,
		isDisabled: false,
		icon: "book-open",
		accentColor: "#5B7FFF",
		createdAt: "2026-03-20T10:00:00.000Z",
		updatedAt: "2026-03-20T10:05:00.000Z",
		queryDefinition: {
			filters: [],
			entitySchemaSlugs: ["schema-1"],
			sort: { field: ["@name"], direction: "asc" },
		},
		displayConfiguration,
	};
}

describe("applySavedViewReorderPatch", () => {
	it("reorders only the targeted tracker scope", () => {
		const views = [
			view("view-1", 1, "tracker-1"),
			view("view-2", 2, "tracker-1"),
			view("view-3", 1, "tracker-2"),
		];

		const result = applySavedViewReorderPatch(views, {
			trackerId: "tracker-1",
			viewIds: ["view-2", "view-1"],
		});

		expect(result.find((item) => item.id === "view-2")?.sortOrder).toBe(1);
		expect(result.find((item) => item.id === "view-1")?.sortOrder).toBe(2);
		expect(result.find((item) => item.id === "view-3")?.sortOrder).toBe(1);
	});

	it("reorders only top-level views when trackerId is omitted", () => {
		const views = [
			view("view-1", 1, null),
			view("view-2", 2, null),
			view("view-3", 1, "tracker-1"),
		];

		const result = applySavedViewReorderPatch(views, {
			viewIds: ["view-2", "view-1"],
		});

		expect(result.find((item) => item.id === "view-2")?.sortOrder).toBe(1);
		expect(result.find((item) => item.id === "view-1")?.sortOrder).toBe(2);
		expect(result.find((item) => item.id === "view-3")?.sortOrder).toBe(1);
	});
});
