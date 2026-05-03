import { describe, expect, it } from "bun:test";
import { createEntityPropertyExpression } from "@ryot/ts-utils";
import {
	createSmartphoneSchema,
	createTabletSchema,
	literalExpression,
} from "~/lib/test-fixtures";
import type { ViewComputedField } from "./expression";
import { inferViewExpressionType } from "./expression-analysis";
import { buildEventJoinMap, buildSchemaMap } from "./reference";

const context = {
	schemaMap: buildSchemaMap([createSmartphoneSchema(), createTabletSchema()]),
	eventJoinMap: buildEventJoinMap([]),
};

describe("inferViewExpressionType", () => {
	it("infers arithmetic, concat, and numeric normalization result types", () => {
		expect(
			inferViewExpressionType({
				context,
				expression: {
					operator: "add",
					type: "arithmetic",
					right: literalExpression(1),
					left: createEntityPropertyExpression("smartphones", "releaseYear"),
				},
			}),
		).toEqual({
			kind: "property",
			propertyType: "integer",
			propertyDefinition: {
				label: "Value",
				type: "integer",
				description: "Computed numeric value",
			},
		});

		expect(
			inferViewExpressionType({
				context,
				expression: {
					type: "concat",
					values: [
						createEntityPropertyExpression("smartphones", "manufacturer"),
						literalExpression(" "),
						createEntityPropertyExpression("smartphones", "releaseYear"),
					],
				},
			}),
		).toEqual({
			kind: "property",
			propertyType: "string",
			propertyDefinition: {
				label: "Value",
				type: "string",
				description: "Computed text value",
			},
		});

		expect(
			inferViewExpressionType({
				context,
				expression: {
					type: "round",
					expression: createEntityPropertyExpression(
						"smartphones",
						"screenSize",
					),
				},
			}),
		).toEqual({
			kind: "property",
			propertyType: "integer",
			propertyDefinition: {
				label: "Value",
				type: "integer",
				description: "Normalized integer value",
			},
		});
	});

	it("unifies conditional branches and keeps image expressions display-only", () => {
		const imageExpression = {
			type: "reference" as const,
			reference: {
				path: ["image"],
				slug: "smartphones",
				type: "entity" as const,
			},
		};

		expect(
			inferViewExpressionType({
				context,
				expression: {
					type: "conditional",
					whenTrue: imageExpression,
					whenFalse: { type: "literal", value: null },
					condition: {
						type: "isNotNull",
						expression: createEntityPropertyExpression(
							"smartphones",
							"manufacturer",
						),
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
						createEntityPropertyExpression("smartphones", "manufacturer"),
						imageExpression,
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
					whenTrue: createEntityPropertyExpression(
						"smartphones",
						"manufacturer",
					),
					whenFalse: createEntityPropertyExpression(
						"smartphones",
						"releaseYear",
					),
					condition: {
						type: "isNotNull",
						expression: createEntityPropertyExpression(
							"smartphones",
							"manufacturer",
						),
					},
				},
			}),
		).toThrow("Expression branches have incompatible types");
	});

	it("infers computed-field references and rejects missing computed fields", () => {
		const computedFieldMap = new Map<string, ViewComputedField>([
			[
				"displayName",
				{
					key: "displayName",
					expression: {
						type: "concat",
						values: [
							createEntityPropertyExpression("smartphones", "manufacturer"),
							literalExpression(" "),
							createEntityPropertyExpression("smartphones", "releaseYear"),
						],
					},
				},
			],
		]);

		expect(
			inferViewExpressionType({
				context,
				computedFieldMap,
				expression: {
					type: "reference",
					reference: { type: "computed-field", key: "displayName" },
				},
			}),
		).toEqual({
			kind: "property",
			propertyType: "string",
			propertyDefinition: {
				label: "Value",
				type: "string",
				description: "Computed text value",
			},
		});

		expect(() =>
			inferViewExpressionType({
				context,
				expression: {
					type: "reference",
					reference: { type: "computed-field", key: "missingField" },
				},
			}),
		).toThrow(
			"Computed field 'missingField' is not part of this runtime request",
		);
	});
});
