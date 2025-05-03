import { z } from "@hono/zod-openapi";
import { createNullableOpenApiRefSchema } from "~/lib/openapi";
import { viewExpressionSchema } from "./expression";

export const canonicalComparisonFilterOperators = [
	"eq",
	"gt",
	"lt",
	"neq",
	"gte",
	"lte",
] as const;

const comparisonFilterOperatorSchema = z.enum(
	canonicalComparisonFilterOperators,
);

export const viewPredicateSchema: z.ZodType<ViewPredicate> = z
	.lazy(() => {
		return z.discriminatedUnion("type", [
			z
				.object({
					type: z.literal("isNull"),
					expression: viewExpressionSchema,
				})
				.strict(),
			z
				.object({
					expression: viewExpressionSchema,
					type: z.literal("isNotNull"),
				})
				.strict(),
			z
				.object({
					type: z.literal("in"),
					expression: viewExpressionSchema,
					values: z.array(viewExpressionSchema).min(1),
				})
				.strict(),
			z
				.object({
					value: viewExpressionSchema,
					expression: viewExpressionSchema,
					type: z.literal("contains"),
				})
				.strict(),
			z
				.object({
					left: viewExpressionSchema,
					right: viewExpressionSchema,
					type: z.literal("comparison"),
					operator: comparisonFilterOperatorSchema,
				})
				.strict(),
			z
				.object({
					type: z.literal("and"),
					predicates: z.array(viewPredicateSchema).min(1),
				})
				.strict(),
			z
				.object({
					type: z.literal("or"),
					predicates: z.array(viewPredicateSchema).min(1),
				})
				.strict(),
			z
				.object({
					type: z.literal("not"),
					predicate: viewPredicateSchema,
				})
				.strict(),
		]);
	})
	.openapi("ViewPredicate");

export const nullableViewPredicateSchema = createNullableOpenApiRefSchema(
	viewPredicateSchema.nullable(),
	{ ref: "ViewPredicate", name: "NullableViewPredicate" },
);

export type ViewPredicate =
	| { type: "isNull"; expression: z.infer<typeof viewExpressionSchema> }
	| { type: "isNotNull"; expression: z.infer<typeof viewExpressionSchema> }
	| {
			type: "in";
			expression: z.infer<typeof viewExpressionSchema>;
			values: z.infer<typeof viewExpressionSchema>[];
	  }
	| {
			type: "contains";
			expression: z.infer<typeof viewExpressionSchema>;
			value: z.infer<typeof viewExpressionSchema>;
	  }
	| {
			type: "comparison";
			left: z.infer<typeof viewExpressionSchema>;
			right: z.infer<typeof viewExpressionSchema>;
			operator: (typeof canonicalComparisonFilterOperators)[number];
	  }
	| { type: "and"; predicates: ViewPredicate[] }
	| { type: "or"; predicates: ViewPredicate[] }
	| { type: "not"; predicate: ViewPredicate };
