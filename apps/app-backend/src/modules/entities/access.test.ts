import { describe, expect, it } from "bun:test";
import { resolveEntityDetailAccess } from "./service";

describe("resolveEntityDetailAccess", () => {
	it("returns not_found when the entity scope is undefined", () => {
		expect(resolveEntityDetailAccess(undefined)).toEqual({
			error: "not_found",
		});
	});

	it("returns builtin when the entity schema is built in", () => {
		expect(
			resolveEntityDetailAccess({
				isBuiltin: true,
				entityId: "entity-1",
				entitySchemaId: "schema-1",
			}),
		).toEqual({ error: "builtin" });
	});

	it("returns the resolved scope when the entity is custom", () => {
		expect(
			resolveEntityDetailAccess({
				isBuiltin: false,
				entityId: "entity-1",
				entitySchemaId: "schema-1",
			}),
		).toEqual({
			access: {
				isBuiltin: false,
				entityId: "entity-1",
				entitySchemaId: "schema-1",
			},
		});
	});
});
