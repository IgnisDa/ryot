import { describe, expect, it } from "bun:test";

import { createSavedViewFixture } from "~/features/test-fixtures";

import { applySavedViewReorderPatch } from "./cache";

describe("applySavedViewReorderPatch", () => {
	it("reorders only the targeted tracker scope", () => {
		const views = [
			createSavedViewFixture({
				id: "view-1",
				sortOrder: 1,
				slug: "view-1",
				name: "view-1",
				isBuiltin: false,
				trackerId: "tracker-1",
			}),
			createSavedViewFixture({
				id: "view-2",
				sortOrder: 2,
				slug: "view-2",
				name: "view-2",
				isBuiltin: false,
				trackerId: "tracker-1",
			}),
			createSavedViewFixture({
				id: "view-3",
				sortOrder: 1,
				slug: "view-3",
				name: "view-3",
				isBuiltin: false,
				trackerId: "tracker-2",
			}),
		];

		const result = applySavedViewReorderPatch(views, {
			trackerId: "tracker-1",
			viewSlugs: ["view-2", "view-1"],
		});

		expect(result.find((item) => item.id === "view-2")?.sortOrder).toBe(1);
		expect(result.find((item) => item.id === "view-1")?.sortOrder).toBe(2);
		expect(result.find((item) => item.id === "view-3")?.sortOrder).toBe(1);
	});

	it("reorders only top-level views when trackerId is omitted", () => {
		const views = [
			createSavedViewFixture({
				id: "view-1",
				sortOrder: 1,
				slug: "view-1",
				name: "view-1",
				trackerId: null,
				isBuiltin: false,
			}),
			createSavedViewFixture({
				id: "view-2",
				sortOrder: 2,
				name: "view-2",
				slug: "view-2",
				trackerId: null,
				isBuiltin: false,
			}),
			createSavedViewFixture({
				id: "view-3",
				sortOrder: 1,
				slug: "view-3",
				name: "view-3",
				isBuiltin: false,
				trackerId: "tracker-1",
			}),
		];

		const result = applySavedViewReorderPatch(views, {
			viewSlugs: ["view-2", "view-1"],
		});

		expect(result.find((item) => item.id === "view-2")?.sortOrder).toBe(1);
		expect(result.find((item) => item.id === "view-1")?.sortOrder).toBe(2);
		expect(result.find((item) => item.id === "view-3")?.sortOrder).toBe(1);
	});
});
