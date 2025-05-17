import { describe, expect, it } from "bun:test";
import {
	resolveCustomEntitySchemaAccess,
	resolveEntitySchemaReadAccess,
} from "./entity-schema-access";

const createEntitySchemaScope = (isBuiltin: boolean) => ({
	isBuiltin,
	userId: "user_1",
	id: "entity_schema_1",
});

describe("resolveEntitySchemaReadAccess", () => {
	it("returns not found when the entity schema is missing", () => {
		const result = resolveEntitySchemaReadAccess(undefined);

		expect(result).toEqual({ error: "not_found" });
	});

	it("returns the entity schema when it is built-in", () => {
		const entitySchema = createEntitySchemaScope(true);

		const result = resolveEntitySchemaReadAccess(entitySchema);

		expect(result).toEqual({ entitySchema });
	});
});

describe("resolveCustomEntitySchemaAccess", () => {
	it("returns not found when the entity schema is missing", () => {
		const result = resolveCustomEntitySchemaAccess(undefined);

		expect(result).toEqual({ error: "not_found" });
	});

	it("returns the entity schema when it is custom", () => {
		const entitySchema = createEntitySchemaScope(false);

		const result = resolveCustomEntitySchemaAccess(entitySchema);

		expect(result).toEqual({ entitySchema });
	});

	it("returns builtin when the entity schema is built-in", () => {
		const result = resolveCustomEntitySchemaAccess(
			createEntitySchemaScope(true),
		);

		expect(result).toEqual({ error: "builtin" });
	});
});
