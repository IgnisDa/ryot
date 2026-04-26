import { z } from "@hono/zod-openapi";
import type { RuntimeRef } from "@ryot/ts-utils";
import { createNullableOpenApiRefSchema } from "~/lib/openapi";
import { nonEmptyTrimmedStringSchema } from "~/lib/zod";
import type { ViewPredicate } from "./filtering";
import { viewPredicateSchema } from "./filtering";

export type JsonValue =
	| null
	| number
	| string
	| boolean
	| JsonValue[]
	| { [key: string]: JsonValue };

export const runtimeReferenceSchema = z
	.discriminatedUnion("type", [
		z
			.object({
				type: z.literal("entity"),
				slug: nonEmptyTrimmedStringSchema,
				path: z.array(nonEmptyTrimmedStringSchema).min(1),
			})
			.strict(),
		z
			.object({
				type: z.literal("event"),
				joinKey: nonEmptyTrimmedStringSchema,
				path: z.array(nonEmptyTrimmedStringSchema).min(1),
			})
			.strict(),
		z
			.object({
				key: nonEmptyTrimmedStringSchema,
				type: z.literal("computed-field"),
			})
			.strict(),
	])
	.openapi("QueryEngineReference");

// Compile-time assertion: Zod schema must remain aligned with the shared RuntimeRef type.
type _RuntimeRefAlignment =
	z.infer<typeof runtimeReferenceSchema> extends RuntimeRef
		? RuntimeRef extends z.infer<typeof runtimeReferenceSchema>
			? true
			: never
		: never;

export type { RuntimeRef };

export const viewComputedFieldSchema = z
	.object({
		expression: z.lazy(() => viewExpressionSchema),
		key: nonEmptyTrimmedStringSchema,
	})
	.strict()
	.openapi("ViewComputedField");

export const computedFieldArraySchema = z
	.array(viewComputedFieldSchema)
	.refine(
		(fields) =>
			new Set(fields.map((field) => field.key)).size === fields.length,
		"Computed field keys must be unique",
	)
	.optional();

export type ViewComputedField = z.infer<typeof viewComputedFieldSchema>;

const isJsonValue = (value: unknown): value is JsonValue => {
	if (value === null) {
		return true;
	}

	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return true;
	}

	if (Array.isArray(value)) {
		return value.every(isJsonValue);
	}

	if (typeof value === "object") {
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			return false;
		}

		return Object.values(value).every(isJsonValue);
	}

	return false;
};

const jsonLiteralValueSchema = z
	.unknown()
	.nullable()
	.refine(isJsonValue, "Literal values must be JSON-safe");

export const viewExpressionSchema: z.ZodType<ViewExpression> = z
	.lazy(() => {
		return z.discriminatedUnion("type", [
			z
				.object({
					value: jsonLiteralValueSchema,
					type: z.literal("literal"),
				})
				.strict(),
			z
				.object({
					reference: runtimeReferenceSchema,
					type: z.literal("reference"),
				})
				.strict(),
			z
				.object({
					type: z.literal("coalesce"),
					values: z.array(viewExpressionSchema).min(1),
				})
				.strict(),
			z
				.object({
					left: viewExpressionSchema,
					right: viewExpressionSchema,
					type: z.literal("arithmetic"),
					operator: z.enum(["add", "subtract", "multiply", "divide"]),
				})
				.strict(),
			z
				.object({
					type: z.literal("round"),
					expression: viewExpressionSchema,
				})
				.strict(),
			z
				.object({
					type: z.literal("floor"),
					expression: viewExpressionSchema,
				})
				.strict(),
			z
				.object({
					expression: viewExpressionSchema,
					type: z.literal("integer"),
				})
				.strict(),
			z
				.object({
					type: z.literal("concat"),
					values: z.array(viewExpressionSchema).min(1),
				})
				.strict(),
			z
				.object({
					whenTrue: viewExpressionSchema,
					whenFalse: viewExpressionSchema,
					type: z.literal("conditional"),
					condition: z.lazy(() => viewPredicateSchema),
				})
				.strict(),
		]);
	})
	.openapi("ViewExpression");

export const nullableViewExpressionSchema = createNullableOpenApiRefSchema(
	viewExpressionSchema.nullable(),
	{ ref: "ViewExpression", name: "NullableViewExpression" },
);

export type ViewExpression =
	| { type: "literal"; value: unknown | null }
	| { type: "reference"; reference: RuntimeRef }
	| { type: "coalesce"; values: ViewExpression[] }
	| {
			type: "arithmetic";
			left: ViewExpression;
			right: ViewExpression;
			operator: "add" | "subtract" | "multiply" | "divide";
	  }
	| { type: "round"; expression: ViewExpression }
	| { type: "floor"; expression: ViewExpression }
	| { type: "integer"; expression: ViewExpression }
	| { type: "concat"; values: ViewExpression[] }
	| {
			type: "conditional";
			whenTrue: ViewExpression;
			whenFalse: ViewExpression;
			condition: ViewPredicate;
	  };

export const nullViewExpression = {
	type: "literal",
	value: null,
} satisfies ViewExpression;
