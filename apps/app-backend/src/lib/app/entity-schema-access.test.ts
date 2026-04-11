import { describe, expect, it } from "bun:test";
import { resolveCustomEntitySchemaAccess } from "./entity-schema-access";

describe("resolveCustomEntitySchemaAccess", () => {
	it("returns not found when the entity schema is missing", () => {
		const result = resolveCustomEntitySchemaAccess(undefined);

		expect(result).toEqual({ error: "not_found" });
	});

	it("returns the entity schema when it is custom", () => {
		const entitySchema = {
			userId: "user_1",
			isBuiltin: false,
			id: "entity_schema_1",
		};

		const result = resolveCustomEntitySchemaAccess(entitySchema);

		expect(result).toEqual({ entitySchema });
	});
});
