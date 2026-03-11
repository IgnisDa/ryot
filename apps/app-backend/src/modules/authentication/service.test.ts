import { describe, expect, it } from "bun:test";
import {
	buildAuthenticationSavedViewInputs,
	resolveAuthenticationName,
} from "./service";

describe("resolveAuthenticationName", () => {
	it("trims the provided signup name", () => {
		expect(resolveAuthenticationName("  New User  ")).toBe("New User");
	});

	it("throws when the signup name is blank", () => {
		expect(() => resolveAuthenticationName("   ")).toThrow(
			"Signup name is required",
		);
	});
});

describe("buildAuthenticationSavedViewInputs", () => {
	it("builds built-in saved views from built-in entity schemas", () => {
		expect(
			buildAuthenticationSavedViewInputs({
				entitySchemas: [{ id: "schema-1", slug: "book" }],
				savedViews: [{ name: "All Books", entitySchemaSlug: "book" }],
			}),
		).toEqual([
			{
				name: "All Books",
				isBuiltin: true,
				queryDefinition: { entitySchemaIds: ["schema-1"] },
			},
		]);
	});

	it("throws when a saved view references a missing built-in entity schema", () => {
		expect(() =>
			buildAuthenticationSavedViewInputs({
				entitySchemas: [],
				savedViews: [{ name: "All Books", entitySchemaSlug: "book" }],
			}),
		).toThrow("Missing built-in entity schema for saved view All Books");
	});
});
