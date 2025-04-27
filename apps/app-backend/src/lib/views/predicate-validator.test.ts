import { describe, expect, it } from "bun:test";
import {
	createSmartphoneSchema,
	createTabletSchema,
} from "~/lib/test-fixtures";
import { validateFilterExpressionAgainstSchemas } from "./predicate-validator";
import { buildSchemaMap } from "./reference";

const tabletSchema = createTabletSchema();
const smartphoneSchema = createSmartphoneSchema();
const smartphoneSchemaWithDatetime = {
	...smartphoneSchema,
	propertiesSchema: {
		fields: {
			...smartphoneSchema.propertiesSchema.fields,
			publishedAt: { type: "datetime" as const },
		},
	},
};
const schemaMap = buildSchemaMap([smartphoneSchema, tabletSchema]);
const schemaMapWithDatetime = buildSchemaMap([
	smartphoneSchemaWithDatetime,
	tabletSchema,
]);

describe("validateFilterExpressionAgainstSchemas", () => {
	it("accepts comparable filters when the value matches the property type", () => {
		expect(() =>
			validateFilterExpressionAgainstSchemas(
				{ op: "eq", field: "smartphones.manufacturer", value: "Apple" },
				schemaMap,
			),
		).not.toThrow();

		expect(() =>
			validateFilterExpressionAgainstSchemas(
				{ op: "gte", field: "smartphones.releaseYear", value: 2024 },
				schemaMap,
			),
		).not.toThrow();
	});

	it("rejects comparable filters when the value does not match the property type", () => {
		expect(() =>
			validateFilterExpressionAgainstSchemas(
				{ op: "eq", field: "smartphones.releaseYear", value: "2024" },
				schemaMap,
			),
		).toThrow(
			"Filter value for 'smartphones.releaseYear' must match the 'integer' property type",
		);
	});

	it("rejects unsupported comparison operators for non-comparable property types", () => {
		expect(() =>
			validateFilterExpressionAgainstSchemas(
				{ op: "gt", field: "smartphones.tags", value: "flagship" },
				schemaMap,
			),
		).toThrow(
			"Filter operator 'gt' is not supported for property type 'array'",
		);
	});

	it("accepts contains for arrays when the value matches the item type", () => {
		expect(() =>
			validateFilterExpressionAgainstSchemas(
				{ op: "contains", field: "smartphones.tags", value: "flagship" },
				schemaMap,
			),
		).not.toThrow();
	});

	it("rejects contains for arrays when the value does not match the item type", () => {
		expect(() =>
			validateFilterExpressionAgainstSchemas(
				{ op: "contains", field: "smartphones.tags", value: 42 },
				schemaMap,
			),
		).toThrow(
			"Filter value for 'smartphones.tags' must match the array item type",
		);
	});

	it("rejects contains for unsupported property types", () => {
		expect(() =>
			validateFilterExpressionAgainstSchemas(
				{ op: "contains", field: "smartphones.releaseYear", value: 2024 },
				schemaMap,
			),
		).toThrow(
			"Filter operator 'contains' is not supported for property type 'integer'",
		);
	});

	it("rejects invalid in filter values", () => {
		expect(() =>
			validateFilterExpressionAgainstSchemas(
				{ op: "in", value: [2024, "2025"], field: "smartphones.releaseYear" },
				schemaMap,
			),
		).toThrow(
			"Filter value for 'smartphones.releaseYear' must match the 'integer' property type",
		);
	});

	it("rejects object contains values that do not match the schema", () => {
		expect(() =>
			validateFilterExpressionAgainstSchemas(
				{
					op: "contains",
					value: { source: 123 },
					field: "smartphones.metadata",
				},
				schemaMap,
			),
		).toThrow(
			"Filter value for 'smartphones.metadata' must match the object schema",
		);

		expect(() =>
			validateFilterExpressionAgainstSchemas(
				{
					op: "contains",
					value: { unknown: "import" },
					field: "smartphones.metadata",
				},
				schemaMap,
			),
		).toThrow(
			"Filter value for 'smartphones.metadata' must match the object schema",
		);
	});

	it("accepts top-level datetime filters with date-only and datetime values", () => {
		expect(() =>
			validateFilterExpressionAgainstSchemas(
				{ op: "gte", field: "@createdAt", value: "2024-01-01" },
				schemaMap,
			),
		).not.toThrow();

		expect(() =>
			validateFilterExpressionAgainstSchemas(
				{ op: "gte", field: "@createdAt", value: "2024-01-01T00:00:00.000Z" },
				schemaMap,
			),
		).not.toThrow();
	});

	it("rejects date-only values for schema-defined datetime properties", () => {
		expect(() =>
			validateFilterExpressionAgainstSchemas(
				{ op: "gte", value: "2024-01-01", field: "smartphones.publishedAt" },
				schemaMapWithDatetime,
			),
		).toThrow(
			"Filter value for 'smartphones.publishedAt' must match the 'datetime' property type",
		);
	});
});
