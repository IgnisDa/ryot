import { z } from "zod";
import { nonEmptyTrimmedStringSchema } from "~/lib/zod/base";

export const runtimeFieldPathSchema = nonEmptyTrimmedStringSchema;

export const canonicalComparisonFilterOperators = [
	"eq",
	"neq",
	"gt",
	"gte",
	"lt",
	"lte",
] as const;

const comparisonFilterOperatorSchema = z.enum(
	canonicalComparisonFilterOperators,
);

const filterExpressionIsNullSchema = z.object({
	value: z.null().optional(),
	op: z.literal("isNull"),
	field: runtimeFieldPathSchema,
});

const filterExpressionIsNotNullSchema = z.object({
	value: z.null().optional(),
	op: z.literal("isNotNull"),
	field: runtimeFieldPathSchema,
});

const filterExpressionInSchema = z.object({
	op: z.literal("in"),
	field: runtimeFieldPathSchema,
	value: z.array(z.unknown()),
});

const filterExpressionComparisonSchema = z.object({
	value: z.unknown(),
	field: runtimeFieldPathSchema,
	op: comparisonFilterOperatorSchema,
});

const filterExpressionContainsSchema = z.object({
	value: z.unknown(),
	field: runtimeFieldPathSchema,
	op: z.literal("contains"),
});

export const filterExpressionSchema = z.union([
	filterExpressionInSchema,
	filterExpressionIsNullSchema,
	filterExpressionContainsSchema,
	filterExpressionIsNotNullSchema,
	filterExpressionComparisonSchema,
]);

export type FilterExpression = z.infer<typeof filterExpressionSchema>;
