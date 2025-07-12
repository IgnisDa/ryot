import { describe, expect, it } from "bun:test";
import {
	createSmartphoneSchema,
	createTabletSchema,
} from "~/lib/test-fixtures";
import type { ViewExpression } from "./expression";
import { inferViewExpressionType } from "./expression-analysis";
import { buildEventJoinMap, buildSchemaMap } from "./reference";

const context = {
	schemaMap: buildSchemaMap([createSmartphoneSchema(), createTabletSchema()]),
	eventJoinMap: buildEventJoinMap([]),
};

const entityExpression = (
	schemaSlug: string,
	field: string,
): ViewExpression => ({
	type: "reference",
	reference: field.startsWith("@")
		? { type: "entity-column", slug: schemaSlug, column: field.slice(1) }
		: { type: "schema-property", slug: schemaSlug, property: field },
});

const literalExpression = (value: unknown): ViewExpression => ({
	value,
	type: "literal",
});

describe("inferViewExpressionType", () => {
	it("infers arithmetic, concat, and numeric normalization result types", () => {
		expect(
			inferViewExpressionType({
				context,
				expression: {
					operator: "add",
					type: "arithmetic",
					right: literalExpression(1),
					left: entityExpression("smartphones", "releaseYear"),
				},
			}),
		).toEqual({
			kind: "property",
			propertyType: "integer",
			propertyDefinition: { type: "integer" },
		});

		expect(
			inferViewExpressionType({
				context,
				expression: {
					type: "concat",
					values: [
						entityExpression("smartphones", "manufacturer"),
						literalExpression(" "),
						entityExpression("smartphones", "releaseYear"),
					],
				},
			}),
		).toEqual({
			kind: "property",
			propertyType: "string",
			propertyDefinition: { type: "string" },
		});

		expect(
			inferViewExpressionType({
				context,
				expression: {
					type: "round",
					expression: entityExpression("smartphones", "screenSize"),
				},
			}),
		).toEqual({
			kind: "property",
			propertyType: "integer",
			propertyDefinition: { type: "integer" },
		});
	});

	it("unifies conditional branches and keeps image expressions display-only", () => {
		expect(
			inferViewExpressionType({
				context,
				expression: {
					type: "conditional",
					whenFalse: { type: "literal", value: null },
					whenTrue: entityExpression("smartphones", "@image"),
					condition: {
						type: "isNotNull",
						expression: entityExpression("smartphones", "manufacturer"),
					},
				},
			}),
		).toEqual({ kind: "image" });

		expect(() =>
			inferViewExpressionType({
				context,
				expression: {
					type: "concat",
					values: [
						entityExpression("smartphones", "manufacturer"),
						entityExpression("smartphones", "@image"),
					],
				},
			}),
		).toThrow(
			"Image expressions are display-only and cannot be used in string composition",
		);

		expect(() =>
			inferViewExpressionType({
				context,
				expression: {
					type: "conditional",
					whenTrue: entityExpression("smartphones", "manufacturer"),
					whenFalse: entityExpression("smartphones", "releaseYear"),
					condition: {
						type: "isNotNull",
						expression: entityExpression("smartphones", "manufacturer"),
					},
				},
			}),
		).toThrow("Expression branches have incompatible types");
	});
});
