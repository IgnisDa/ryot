import { describe, expect, it } from "bun:test";
import { createEventSchemaFixture } from "#/features/test-fixtures";
import { getEntityEventSchemaViewState } from "./model";

describe("getEntityEventSchemaViewState", () => {
	it("returns empty when an entity schema has no event schemas", () => {
		const state = getEntityEventSchemaViewState([]);

		expect(state).toEqual({ type: "empty" });
	});

	it("returns sorted event schemas when present", () => {
		const state = getEntityEventSchemaViewState([
			createEventSchemaFixture({ id: "2", name: "Progress", slug: "progress" }),
			createEventSchemaFixture({ id: "3", name: "Finished", slug: "zulu" }),
			createEventSchemaFixture({ id: "1", name: "Finished", slug: "alpha" }),
		]);

		expect(state.type).toBe("list");
		if (state.type !== "list") {
			throw new Error("Expected list state");
		}
		expect(state.eventSchemas.map((schema) => schema.slug)).toEqual([
			"alpha",
			"zulu",
			"progress",
		]);
	});
});
