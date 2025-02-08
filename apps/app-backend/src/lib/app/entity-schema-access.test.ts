import { describe, expect, it } from "bun:test";
import {
	resolveCustomEntityAccessError,
	resolveCustomEntitySchemaAccess,
} from "./entity-schema-access";

describe("resolveCustomEntitySchemaAccess", () => {
	it("returns not found when the entity schema is missing", () => {
		const result = resolveCustomEntitySchemaAccess(undefined);

		expect(result).toEqual({ error: "not_found" });
	});

	it("rejects built-in entity schemas", () => {
		const result = resolveCustomEntitySchemaAccess({
			userId: null,
			isBuiltin: true,
			id: "entity_schema_1",
		});

		expect(result).toEqual({ error: "builtin" });
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

describe("resolveCustomEntityAccessError", () => {
	it("returns a not found response for missing access", () => {
		expect(
			resolveCustomEntityAccessError({
				error: "not_found",
				notFoundMessage: "Entity not found",
				builtinMessage:
					"Built-in entity schemas do not support generated event logging",
			}),
		).toEqual({
			error: "not_found",
			message: "Entity not found",
		});
	});

	it("returns a validation response for built-in access", () => {
		expect(
			resolveCustomEntityAccessError({
				error: "builtin",
				notFoundMessage: "Entity not found",
				builtinMessage:
					"Built-in entity schemas do not support generated event logging",
			}),
		).toEqual({
			error: "builtin",
			message: "Built-in entity schemas do not support generated event logging",
		});
	});
});
