import { describe, expect, it } from "bun:test";
import { resolveCustomEntitySchemaAccess } from "~/lib/entity-schema-access";

describe("resolveCustomEntitySchemaAccess", () => {
	it("returns error when entity schema is undefined", () => {
		expect(resolveCustomEntitySchemaAccess(undefined)).toEqual({
			error: "not_found",
		});
	});

	it("returns error when entity schema is builtin", () => {
		const entitySchema = {
			id: "schema-1",
			isBuiltin: true,
			userId: "user-1",
			propertiesSchema: {},
		};

		expect(resolveCustomEntitySchemaAccess(entitySchema)).toEqual({
			error: "builtin",
		});
	});

	it("returns entity schema when custom and found", () => {
		const entitySchema = {
			id: "schema-1",
			userId: "user-1",
			isBuiltin: false,
			propertiesSchema: {},
		};

		expect(resolveCustomEntitySchemaAccess(entitySchema)).toEqual({
			entitySchema,
		});
	});
});
