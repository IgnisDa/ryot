import { expect, it } from "@effect/vitest";
import { PropertyValidationError } from "@ryot-app/contract/schema/property-schema";
import { Effect } from "effect";
import { describe } from "vitest";

import {
	parseAppSchemaPropertiesSafe,
	parseLabeledPropertySchemaInput,
} from "./property-schema-runtime";
import { fixtureEntityPropertiesSchema } from "./property-schema.test-fixture";

describe("property schema DSL", () => {
	it.effect("parses a valid schema definition", () =>
		Effect.gen(function* () {
			const parsed = yield* parseLabeledPropertySchemaInput(
				{ fields: { rating: { type: "number", label: "Rating", description: "Rating" } } },
				"Entity schema properties",
			);

			expect(parsed).toEqual({
				fields: { rating: { type: "number", label: "Rating", description: "Rating" } },
			});
		}),
	);

	it.effect("rejects empty fields with the provided label", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				parseLabeledPropertySchemaInput({ fields: {} }, "Entity schema properties"),
			);

			expect(error).toBeInstanceOf(PropertyValidationError);
			expect(error.message).toContain(
				"Entity schema properties must contain at least one property",
			);
		}),
	);

	it.effect("rejects rules that point at missing fields", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				parseLabeledPropertySchemaInput(
					{
						fields: { status: { type: "string", label: "Status", description: "Status" } },
						rules: [
							{
								kind: "validation",
								path: ["progressPercent"],
								validation: { required: true },
								when: { operator: "eq", path: ["status"], value: "completed" },
							},
						],
					},
					"Event schema properties",
				),
			);

			expect(error.issues).toContainEqual({
				path: ["rules", "0", "path"],
				message: "Rule path 'progressPercent' does not exist",
			});
		}),
	);

	it.effect("applies defaults, normalization, and rule-driven required validation", () =>
		Effect.gen(function* () {
			const schema = yield* parseLabeledPropertySchemaInput(
				{
					rules: [
						{
							kind: "validation",
							path: ["progressPercent"],
							validation: { required: true },
							when: { operator: "eq", path: ["status"], value: "completed" },
						},
					],
					fields: {
						status: {
							type: "string",
							label: "Status",
							description: "Status",
							validation: { required: true },
						},
						progressPercent: {
							type: "number",
							defaultValue: 0,
							label: "Progress Percent",
							description: "Progress Percent",
							normalize: { round: { scale: 2 } },
							validation: { minimum: 0, exclusiveMaximum: 100 },
						},
					},
				},
				"Event properties",
			);

			expect(
				parseAppSchemaPropertiesSafe({ propertiesSchema: schema, properties: { status: "draft" } }),
			).toEqual({ success: true, data: { status: "draft", progressPercent: 0 } });

			const completed = parseAppSchemaPropertiesSafe({
				propertiesSchema: schema,
				properties: { status: "completed", progressPercent: 25.555 },
			});

			expect(completed).toEqual({
				success: true,
				data: { status: "completed", progressPercent: 25.56 },
			});
		}),
	);

	it.effect("respects object unknown-key policies during payload validation", () =>
		Effect.gen(function* () {
			const schema = yield* parseLabeledPropertySchemaInput(
				{
					fields: {
						looseMeta: {
							type: "object",
							label: "Loose Meta",
							description: "Loose Meta",
							unknownKeys: "passthrough",
							properties: { name: { label: "Name", type: "string", description: "Name" } },
						},
						strictMeta: {
							type: "object",
							label: "Strict Meta",
							unknownKeys: "strict",
							description: "Strict Meta",
							properties: {
								name: {
									label: "Name",
									type: "string",
									description: "Name",
									validation: { required: true },
								},
							},
						},
					},
				},
				"Entity properties",
			);

			const strictResult = parseAppSchemaPropertiesSafe({
				propertiesSchema: schema,
				properties: { strictMeta: { name: "Ada", extra: true } },
			});
			expect(strictResult.success).toBe(false);
			if (!strictResult.success) {
				expect(strictResult.issues).toContainEqual({
					path: ["strictMeta", "extra"],
					message: "Expected no excess property",
				});
			}

			const passthroughResult = parseAppSchemaPropertiesSafe({
				propertiesSchema: schema,
				properties: { looseMeta: { name: "Ada", extra: true } },
			});
			expect(passthroughResult).toEqual({
				success: true,
				data: { looseMeta: { name: "Ada", extra: true } },
			});
		}),
	);

	it.effect("accepts representative schema data", () =>
		parseLabeledPropertySchemaInput(fixtureEntityPropertiesSchema, "Entity properties"),
	);
});
