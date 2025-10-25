import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { exercisePropertiesSchema } from "./builtins/fitness-property-schemas";
import { bookPropertiesSchema } from "./builtins/media-property-schemas";
import {
	formatPropertyIssues,
	parseAppSchemaPropertiesSafe,
	parseLabeledPropertySchemaInput,
	PropertyValidationError,
} from "./schema";

describe("property schema DSL", () => {
	it.effect("parses a valid schema definition", () =>
		Effect.gen(function* () {
			const parsed = yield* parseLabeledPropertySchemaInput(
				{ fields: { rating: { label: "Rating", description: "Rating", type: "number" } } },
				"Entity schema properties",
			);

			expect(parsed).toEqual({
				fields: { rating: { label: "Rating", description: "Rating", type: "number" } },
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

	it.effect("applies defaults, rounding, and rule-driven required validation", () =>
		Effect.gen(function* () {
			const schema = yield* parseLabeledPropertySchemaInput(
				{
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
							validation: { exclusiveMaximum: 100, minimum: 0 },
							transform: { round: { mode: "half_up", scale: 2 } },
						},
					},
					rules: [
						{
							kind: "validation",
							path: ["progressPercent"],
							validation: { required: true },
							when: { operator: "eq", path: ["status"], value: "completed" },
						},
					],
				},
				"Event properties",
			);

			expect(
				parseAppSchemaPropertiesSafe({ properties: { status: "draft" }, propertiesSchema: schema }),
			).toEqual({ success: true, data: { progressPercent: 0, status: "draft" } });

			const completed = parseAppSchemaPropertiesSafe({
				propertiesSchema: schema,
				properties: { status: "completed", progressPercent: 25.555 },
			});

			expect(completed).toEqual({
				success: true,
				data: { progressPercent: 25.56, status: "completed" },
			});
		}),
	);

	it.effect("respects object unknown-key policies during payload validation", () =>
		Effect.gen(function* () {
			const schema = yield* parseLabeledPropertySchemaInput(
				{
					fields: {
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
						looseMeta: {
							type: "object",
							label: "Loose Meta",
							description: "Loose Meta",
							unknownKeys: "passthrough",
							properties: { name: { type: "string", label: "Name", description: "Name" } },
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
				expect(formatPropertyIssues(strictResult.issues)).toContain("strictMeta.extra");
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

	it.effect("accepts builtin schema data", () =>
		Effect.gen(function* () {
			yield* parseLabeledPropertySchemaInput(bookPropertiesSchema, "Book properties");
			yield* parseLabeledPropertySchemaInput(exercisePropertiesSchema, "Exercise properties");
		}),
	);
});
