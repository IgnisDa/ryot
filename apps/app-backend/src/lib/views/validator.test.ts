import { describe, expect, it } from "bun:test";
import {
	createSmartphoneSchema,
	createTabletSchema,
} from "~/lib/test-fixtures";
import { buildSchemaMap } from "./reference";
import {
	validateReferenceAgainstSchemas,
	validateViewRuntimeReferences,
} from "./validator";

const tabletSchema = createTabletSchema();
const smartphoneSchema = createSmartphoneSchema();
const schemaMap = buildSchemaMap([smartphoneSchema, tabletSchema]);
const sortFilterBuiltins = new Set(["name", "createdAt", "updatedAt"]);
const displayBuiltins = new Set(["name", "image", "createdAt", "updatedAt"]);

describe("validateReferenceAgainstSchemas - built-in paths", () => {
	it("accepts valid sort/filter builtins", () => {
		expect(() =>
			validateReferenceAgainstSchemas("@name", schemaMap, sortFilterBuiltins),
		).not.toThrow();
		expect(() =>
			validateReferenceAgainstSchemas(
				"@createdAt",
				schemaMap,
				sortFilterBuiltins,
			),
		).not.toThrow();
		expect(() =>
			validateReferenceAgainstSchemas(
				"@updatedAt",
				schemaMap,
				sortFilterBuiltins,
			),
		).not.toThrow();
	});

	it("rejects @image in sort/filter context", () => {
		expect(() =>
			validateReferenceAgainstSchemas("@image", schemaMap, sortFilterBuiltins),
		).toThrow("Unsupported column '@image'");
	});

	it("accepts @image in display context", () => {
		expect(() =>
			validateReferenceAgainstSchemas("@image", schemaMap, displayBuiltins),
		).not.toThrow();
	});

	it("rejects unknown builtin columns", () => {
		expect(() =>
			validateReferenceAgainstSchemas("@nam", schemaMap, sortFilterBuiltins),
		).toThrow("Unsupported column '@nam'");
		expect(() =>
			validateReferenceAgainstSchemas(
				"@unknown",
				schemaMap,
				sortFilterBuiltins,
			),
		).toThrow();
	});
});

describe("validateReferenceAgainstSchemas - schema-qualified paths", () => {
	it("accepts valid schema.property references", () => {
		expect(() =>
			validateReferenceAgainstSchemas(
				"smartphones.nameplate",
				schemaMap,
				sortFilterBuiltins,
			),
		).not.toThrow();
		expect(() =>
			validateReferenceAgainstSchemas(
				"smartphones.releaseYear",
				schemaMap,
				sortFilterBuiltins,
			),
		).not.toThrow();
		expect(() =>
			validateReferenceAgainstSchemas(
				"tablets.maker",
				schemaMap,
				sortFilterBuiltins,
			),
		).not.toThrow();
	});

	it("rejects a property that does not exist in the schema", () => {
		expect(() =>
			validateReferenceAgainstSchemas(
				"smartphones.storage_g",
				schemaMap,
				sortFilterBuiltins,
			),
		).toThrow("Property 'storage_g' not found in schema 'smartphones'");
	});

	it("rejects a schema slug that is not in the schema map", () => {
		expect(() =>
			validateReferenceAgainstSchemas(
				"laptops.cpu",
				schemaMap,
				sortFilterBuiltins,
			),
		).toThrow("Schema 'laptops' is not part of this runtime request");
	});

	it("rejects bare-word paths without a dot", () => {
		expect(() =>
			validateReferenceAgainstSchemas(
				"manufacturer",
				schemaMap,
				sortFilterBuiltins,
			),
		).toThrow();
	});
});

describe("validateViewRuntimeReferences - sort fields", () => {
	const baseRequest = {
		layout: "grid" as const,
		filters: [],
		entitySchemaSlugs: ["smartphones"],
		displayConfiguration: {
			imageProperty: null,
			titleProperty: ["@name"],
			badgeProperty: null,
			subtitleProperty: null,
		},
	};

	it("accepts valid sort fields", () => {
		expect(() =>
			validateViewRuntimeReferences(
				{ ...baseRequest, sort: { fields: ["@name"], direction: "asc" } },
				schemaMap,
			),
		).not.toThrow();
		expect(() =>
			validateViewRuntimeReferences(
				{
					...baseRequest,
					sort: {
						fields: ["smartphones.releaseYear"],
						direction: "asc",
					},
				},
				schemaMap,
			),
		).not.toThrow();
	});

	it("rejects a sort field with a non-existent property", () => {
		expect(() =>
			validateViewRuntimeReferences(
				{
					...baseRequest,
					sort: { fields: ["smartphones.storage_g"], direction: "asc" },
				},
				schemaMap,
			),
		).toThrow("Property 'storage_g' not found in schema 'smartphones'");
	});

	it("rejects @image in sort context", () => {
		expect(() =>
			validateViewRuntimeReferences(
				{ ...baseRequest, sort: { fields: ["@image"], direction: "asc" } },
				schemaMap,
			),
		).toThrow("Unsupported column '@image'");
	});
});

describe("validateViewRuntimeReferences - display configuration", () => {
	const baseSort = { fields: ["@name"], direction: "asc" as const };

	it("accepts @image in display config but rejects it in sort", () => {
		expect(() =>
			validateViewRuntimeReferences(
				{
					layout: "grid" as const,
					filters: [],
					sort: baseSort,
					entitySchemaSlugs: ["smartphones"],
					displayConfiguration: {
						imageProperty: ["@image"],
						titleProperty: ["@name"],
						badgeProperty: null,
						subtitleProperty: null,
					},
				},
				schemaMap,
			),
		).not.toThrow();
	});

	it("rejects an invalid display property path", () => {
		expect(() =>
			validateViewRuntimeReferences(
				{
					layout: "grid" as const,
					filters: [],
					sort: baseSort,
					entitySchemaSlugs: ["smartphones"],
					displayConfiguration: {
						imageProperty: null,
						titleProperty: ["@nam"],
						badgeProperty: null,
						subtitleProperty: null,
					},
				},
				schemaMap,
			),
		).toThrow("Unsupported column '@nam'");
	});

	it("rejects a table column with a non-existent property", () => {
		expect(() =>
			validateViewRuntimeReferences(
				{
					layout: "table" as const,
					filters: [],
					sort: baseSort,
					entitySchemaSlugs: ["smartphones"],
					displayConfiguration: {
						columns: [{ property: ["smartphones.storage_g"] }],
					},
				},
				schemaMap,
			),
		).toThrow("Property 'storage_g' not found in schema 'smartphones'");
	});
});
