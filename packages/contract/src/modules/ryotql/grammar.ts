import { Schema } from "effect";

import { strictStruct } from "../../schema/utils";

const JsonPathSegment = Schema.Union([Schema.String, Schema.Finite]);
export const CastTarget = Schema.Literals(["boolean", "date", "json", "number", "text"]);
export const JsonPath = Schema.NonEmptyArray(JsonPathSegment);
export const TransformName = Schema.Literals(["kebabCase", "titleCase"]);
export const DateBucketUnit = Schema.Literals(["hour", "day", "week", "month", "year"]);

export const scalarOperations = <
	Expression,
	Predicate,
	Query,
	Aggregation,
	Ordering,
	TimeZone,
	Bucket,
>(input: {
	readonly query: Schema.Codec<Query, unknown>;
	readonly bucket: Schema.Codec<Bucket, unknown>;
	readonly ordering: Schema.Codec<Ordering, unknown>;
	readonly timeZone: Schema.Codec<TimeZone, unknown>;
	readonly predicate: Schema.Codec<Predicate, unknown>;
	readonly expression: Schema.Codec<Expression, unknown>;
	readonly aggregation: Schema.Codec<Aggregation, unknown>;
}) =>
	Schema.Union([
		strictStruct({
			type: Schema.Literal("coalesce"),
			values: Schema.NonEmptyArray(input.expression),
		}),
		strictStruct({
			type: Schema.Literal("concat"),
			values: Schema.NonEmptyArray(input.expression),
		}),
		strictStruct({
			condition: input.predicate,
			whenTrue: input.expression,
			whenFalse: input.expression,
			type: Schema.Literal("conditional"),
		}),
		strictStruct({ target: CastTarget, expr: input.expression, type: Schema.Literal("cast") }),
		strictStruct({
			name: TransformName,
			expr: input.expression,
			type: Schema.Literal("transform"),
		}),
		strictStruct({ expr: input.expression, type: Schema.Literal("floor") }),
		strictStruct({ expr: input.expression, type: Schema.Literal("integer") }),
		strictStruct({ expr: input.expression, type: Schema.Literal("isNotNull") }),
		strictStruct({ expr: input.expression, type: Schema.Literal("round") }),
		strictStruct({
			expr: input.expression,
			timeZone: input.timeZone,
			type: Schema.Literal("localDate"),
		}),
		strictStruct({
			expr: input.expression,
			timeZone: input.timeZone,
			type: Schema.Literal("localHour"),
		}),
		strictStruct({
			bucket: input.bucket,
			expr: input.expression,
			timeZone: input.timeZone,
			type: Schema.Literal("dateBucket"),
		}),
		strictStruct({ path: JsonPath, expr: input.expression, type: Schema.Literal("jsonPath") }),
		strictStruct({
			query: input.query,
			aggregation: input.aggregation,
			type: Schema.Literal("aggregate"),
		}),
		strictStruct({
			left: input.expression,
			right: input.expression,
			type: Schema.Literal("arithmetic"),
			operator: Schema.Literals(["add", "divide", "multiply", "subtract"]),
		}),
		strictStruct({
			query: input.query,
			orderBy: input.ordering,
			select: input.expression,
			type: Schema.Literal("first"),
		}),
	]);
