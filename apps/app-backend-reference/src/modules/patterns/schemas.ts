import { Schema } from "effect";

export const PatternsMode = Schema.Literal("commit", "rollback");

export type PatternsMode = typeof PatternsMode.Type;

export const DbTransactionPayload = Schema.Struct({
	mode: PatternsMode,
});

export type DbTransactionPayload = typeof DbTransactionPayload.Type;

export const RunUniqueConstraintPayload = Schema.Struct({
	query: Schema.String,
	duplicate: Schema.Boolean,
});

export type RunUniqueConstraintPayload = typeof RunUniqueConstraintPayload.Type;

export const PatternsRun = Schema.Struct({
	id: Schema.String,
});

export type PatternsRun = typeof PatternsRun.Type;

export const PatternsStep = Schema.Struct({
	id: Schema.String,
});

export type PatternsStep = typeof PatternsStep.Type;

export const PatternsItem = Schema.Struct({
	id: Schema.String,
	query: Schema.String,
});

export type PatternsItem = typeof PatternsItem.Type;

export const PatternsResult = Schema.Struct({
	runId: Schema.String,
	stepId: Schema.String,
});

export type PatternsResult = typeof PatternsResult.Type;

export const UniqueConstraintResult = Schema.Struct({
	query: Schema.String,
	runId: Schema.String,
	itemId: Schema.String,
});

export type UniqueConstraintResult = typeof UniqueConstraintResult.Type;

// Recursive schema demo — mirrors the z.lazy pattern from the real backend.
//
// The TypeScript type must be declared separately because Schema.Schema.Type
// cannot resolve circular references at the type level (same reason Zod
// requires `z.ZodType<T>` for recursive schemas).
export type FilterConditionType =
	| { readonly kind: "and"; readonly conditions: readonly FilterConditionType[] }
	| { readonly kind: "or"; readonly conditions: readonly FilterConditionType[] }
	| { readonly kind: "not"; readonly condition: FilterConditionType }
	| { readonly kind: "contains"; readonly value: string }
	| { readonly kind: "equals"; readonly value: string };

// Schema.annotations({ identifier }) is required — without it the OpenAPI
// generator throws MissingIdentifierAnnotationError when it encounters the
// Suspend node and cannot emit a $ref.
export const FilterCondition: Schema.Schema<FilterConditionType> = Schema.suspend(() =>
	Schema.Union(
		Schema.Struct({ kind: Schema.Literal("and"), conditions: Schema.Array(FilterCondition) }),
		Schema.Struct({ kind: Schema.Literal("or"), conditions: Schema.Array(FilterCondition) }),
		Schema.Struct({ kind: Schema.Literal("not"), condition: FilterCondition }),
		Schema.Struct({ kind: Schema.Literal("contains"), value: Schema.String }),
		Schema.Struct({ kind: Schema.Literal("equals"), value: Schema.String }),
	),
).pipe(Schema.annotations({ identifier: "FilterCondition", title: "Filter Condition" }));

export const FilterConditionPayload = Schema.Struct({ filter: FilterCondition });

export type FilterConditionPayload = typeof FilterConditionPayload.Type;

export const FilterResult = Schema.Struct({ status: Schema.Literal(true) });

export type FilterResult = typeof FilterResult.Type;
