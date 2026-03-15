import { describe, expect, it } from "bun:test";
import type { AppEventSchema } from "./model";
import { getEntityEventSchemaViewState } from "./model";

function createEventSchemaFixture(
	overrides: Partial<AppEventSchema> = {},
): AppEventSchema {
	return {
		name: "Schema",
		slug: "schema",
		id: "schema-id",
		propertiesSchema: {},
		entitySchemaId: "entity-schema-id",
		...overrides,
	};
}

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
		if (state.type !== "list") throw new Error("Expected list state");
		expect(state.eventSchemas.map((schema) => schema.slug)).toEqual([
			"alpha",
			"zulu",
			"progress",
		]);
	});
});
