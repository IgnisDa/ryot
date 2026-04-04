import { describe, expect, it } from "bun:test";
import { createSavedViewFixture } from "~/features/test-fixtures";
import {
	findBuiltinCollectionsView,
	resolveCollectionsDestination,
} from "./model";

describe("useCollectionsDestination hook prerequisites", () => {
	describe("findBuiltinCollectionsView", () => {
		it("returns undefined when no matching view exists", () => {
			const views = [
				createSavedViewFixture({
					id: "view-1",
					isBuiltin: true,
					trackerId: null,
					queryDefinition: { entitySchemaSlugs: ["movie"] },
				}),
			];

			const result = findBuiltinCollectionsView(views);

			expect(result).toBeUndefined();
		});

		it("returns view when builtin collections view exists", () => {
			const views = [
				createSavedViewFixture({
					id: "view-collections",
					isBuiltin: true,
					trackerId: null,
					queryDefinition: { entitySchemaSlugs: ["collection"] },
				}),
			];

			const result = findBuiltinCollectionsView(views);

			expect(result).toBeDefined();
			expect(result?.id).toBe("view-collections");
		});

		it("returns undefined when view is not builtin", () => {
			const views = [
				createSavedViewFixture({
					id: "view-1",
					isBuiltin: false,
					trackerId: null,
					queryDefinition: { entitySchemaSlugs: ["collection"] },
				}),
			];

			const result = findBuiltinCollectionsView(views);

			expect(result).toBeUndefined();
		});

		it("returns undefined when view has trackerId", () => {
			const views = [
				createSavedViewFixture({
					id: "view-1",
					isBuiltin: true,
					trackerId: "tracker-1",
					queryDefinition: { entitySchemaSlugs: ["collection"] },
				}),
			];

			const result = findBuiltinCollectionsView(views);

			expect(result).toBeUndefined();
		});

		it("returns first matching view when multiple exist", () => {
			const views = [
				createSavedViewFixture({
					id: "view-collections",
					isBuiltin: true,
					trackerId: null,
					queryDefinition: { entitySchemaSlugs: ["collection", "movie"] },
				}),
			];

			const result = findBuiltinCollectionsView(views);

			expect(result?.id).toBe("view-collections");
		});
	});

	describe("resolveCollectionsDestination", () => {
		it("returns none when no builtin collections view exists", () => {
			const views: ReturnType<typeof createSavedViewFixture>[] = [];

			const result = resolveCollectionsDestination(views);

			expect(result).toEqual({ type: "none" });
		});

		it("returns view with id when builtin collections view exists", () => {
			const views = [
				createSavedViewFixture({
					id: "view-collections",
					isBuiltin: true,
					trackerId: null,
					queryDefinition: { entitySchemaSlugs: ["collection"] },
				}),
			];

			const result = resolveCollectionsDestination(views);

			expect(result).toEqual({ type: "view", viewId: "view-collections" });
		});
	});
});
