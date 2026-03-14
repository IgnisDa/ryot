import { describe, expect, it } from "bun:test";
import { createTrackerFixture } from "#/features/trackers/test-fixtures";
import type { AppEntitySchema } from "./model";
import { getTrackerEntitySchemaViewState } from "./model";

function createEntitySchemaFixture(
	overrides: Partial<AppEntitySchema> = {},
): AppEntitySchema {
	return {
		name: "Schema",
		slug: "schema",
		id: "schema-id",
		isBuiltin: false,
		icon: "book-open",
		trackerId: "tracker-id",
		accentColor: "#5B7FFF",
		propertiesSchema: {},
		...overrides,
	};
}

describe("getTrackerEntitySchemaViewState", () => {
	it("returns builtin for built-in trackers", () => {
		const tracker = createTrackerFixture({ isBuiltin: true });

		const state = getTrackerEntitySchemaViewState({
			tracker,
			entitySchemas: [createEntitySchemaFixture()],
		});

		expect(state).toEqual({ type: "builtin" });
	});

	it("returns empty when a custom tracker has no schemas", () => {
		const tracker = createTrackerFixture({ isBuiltin: false });

		const state = getTrackerEntitySchemaViewState({
			tracker,
			entitySchemas: [],
		});

		expect(state).toEqual({ type: "empty" });
	});

	it("returns sorted schemas for custom trackers with schemas", () => {
		const tracker = createTrackerFixture({ isBuiltin: false });

		const state = getTrackerEntitySchemaViewState({
			tracker,
			entitySchemas: [
				createEntitySchemaFixture({ id: "2", name: "Bravo", slug: "bravo" }),
				createEntitySchemaFixture({ id: "3", name: "Alpha", slug: "zulu" }),
				createEntitySchemaFixture({ id: "1", name: "Alpha", slug: "alpha" }),
			],
		});

		expect(state.type).toBe("list");
		if (state.type !== "list") throw new Error("Expected list state");
		expect(state.entitySchemas.map((schema) => schema.slug)).toEqual([
			"alpha",
			"zulu",
			"bravo",
		]);
	});
});
