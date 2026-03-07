import { Schema } from "effect";

import { strictStruct } from "../../schema/utils";

export const TableReference = strictStruct({
	alias: Schema.String,
	table: Schema.String,
}).annotate({ identifier: "RyotQLTableReference" });
export type TableReference = typeof TableReference.Type;

export const ColumnExpression = strictStruct({
	field: Schema.String,
	tableAlias: Schema.String,
	type: Schema.Literal("column"),
}).annotate({ identifier: "RyotQLColumnExpression" });
export type ColumnExpression = typeof ColumnExpression.Type;

const JsonPrimitive = Schema.Union([Schema.Null, Schema.String, Schema.Finite, Schema.Boolean]);

export type JsonValue =
	| readonly JsonValue[]
	| typeof JsonPrimitive.Type
	| { readonly [key: string]: JsonValue };

export const JsonValue: Schema.Codec<JsonValue, JsonValue> = Schema.suspend(() =>
	Schema.Union([JsonPrimitive, Schema.Array(JsonValue), Schema.Record(Schema.String, JsonValue)]),
).annotate({ identifier: "RyotQLJsonValue" });

export const LiteralExpression = strictStruct({
	value: JsonValue,
	type: Schema.Literal("literal"),
}).annotate({ identifier: "RyotQLLiteralExpression" });
export type LiteralExpression = typeof LiteralExpression.Type;

const JsonPathSegment = Schema.Union([Schema.String, Schema.Number]);
const CastTarget = Schema.Literals(["boolean", "date", "json", "number", "text"]);
const JsonPath = Schema.NonEmptyArray(JsonPathSegment);

export type CorrelatedQuerySet = {
	readonly from: TableReference;
	readonly where?: Predicate | undefined;
	readonly joins?: readonly [Join, ...Join[]] | undefined;
};

export type AggregationSpec =
	| { readonly function: "count" }
	| { readonly expr: ScalarExpression; readonly function: "countDistinct" }
	| {
			readonly expr: ScalarExpression;
			readonly function: "average" | "maximum" | "minimum" | "sum";
	  };

export type ExistsExpression = {
	readonly type: "exists";
	readonly query: CorrelatedQuerySet;
};

export type ScalarExpression =
	| ColumnExpression
	| LiteralExpression
	| {
			readonly type: "cast";
			readonly expr: ScalarExpression;
			readonly target: typeof CastTarget.Type;
	  }
	| {
			readonly type: "jsonPath";
			readonly expr: ScalarExpression;
			readonly path: typeof JsonPath.Type;
	  }
	| {
			readonly type: "coalesce";
			readonly values: readonly [ScalarExpression, ...ScalarExpression[]];
	  }
	| ExistsExpression
	| {
			readonly type: "arithmetic";
			readonly left: ScalarExpression;
			readonly right: ScalarExpression;
			readonly operator: "add" | "divide" | "multiply" | "subtract";
	  }
	| {
			readonly type: "aggregate";
			readonly query: CorrelatedQuerySet;
			readonly aggregation: AggregationSpec;
	  }
	| {
			readonly type: "first";
			readonly select: ScalarExpression;
			readonly query: CorrelatedQuerySet;
			readonly orderBy: readonly [OrderBy, ...OrderBy[]];
	  };

export const CorrelatedQuerySet: Schema.Codec<CorrelatedQuerySet, unknown> = Schema.suspend(() =>
	strictStruct({
		from: TableReference,
		where: Schema.optional(Predicate),
		joins: Schema.optional(Schema.NonEmptyArray(Join)),
	}),
).annotate({ identifier: "RyotQLCorrelatedQuerySet" });

export const AggregationSpec: Schema.Codec<AggregationSpec, unknown> = Schema.suspend(() =>
	Schema.Union([
		strictStruct({ function: Schema.Literal("count") }),
		strictStruct({ expr: ScalarExpression, function: Schema.Literal("countDistinct") }),
		strictStruct({
			expr: ScalarExpression,
			function: Schema.Literals(["average", "maximum", "minimum", "sum"]),
		}),
	]),
).annotate({ identifier: "RyotQLAggregationSpec" });

export const ExistsExpression: Schema.Codec<ExistsExpression, unknown> = Schema.suspend(() =>
	strictStruct({ query: CorrelatedQuerySet, type: Schema.Literal("exists") }),
).annotate({ identifier: "RyotQLExistsExpression" });

export const ScalarExpression: Schema.Codec<ScalarExpression, unknown> = Schema.suspend(() =>
	Schema.Union([
		ColumnExpression,
		LiteralExpression,
		ExistsExpression,
		strictStruct({
			type: Schema.Literal("coalesce"),
			values: Schema.NonEmptyArray(ScalarExpression),
		}),
		strictStruct({
			target: CastTarget,
			expr: ScalarExpression,
			type: Schema.Literal("cast"),
		}),
		strictStruct({
			path: JsonPath,
			expr: ScalarExpression,
			type: Schema.Literal("jsonPath"),
		}),
		strictStruct({
			query: CorrelatedQuerySet,
			aggregation: AggregationSpec,
			type: Schema.Literal("aggregate"),
		}),
		strictStruct({
			left: ScalarExpression,
			right: ScalarExpression,
			type: Schema.Literal("arithmetic"),
			operator: Schema.Literals(["add", "divide", "multiply", "subtract"]),
		}),
		strictStruct({
			query: CorrelatedQuerySet,
			select: ScalarExpression,
			type: Schema.Literal("first"),
			orderBy: Schema.NonEmptyArray(OrderBy),
		}),
	]),
).annotate({ identifier: "RyotQLScalarExpression" });

const IsNullPredicate = strictStruct({
	expr: ScalarExpression,
	type: Schema.Literal("isNull"),
});

const IsNotNullPredicate = strictStruct({
	expr: ScalarExpression,
	type: Schema.Literal("isNotNull"),
});

const InPredicate = strictStruct({
	expr: ScalarExpression,
	type: Schema.Literal("in"),
	values: Schema.Array(ScalarExpression),
});

const ContainsPredicate = strictStruct({
	left: ScalarExpression,
	right: ScalarExpression,
	type: Schema.Literal("contains"),
});

const ComparisonOperator = Schema.Literals(["eq", "gt", "gte", "lt", "lte", "neq"]);

const ComparisonPredicate = strictStruct({
	left: ScalarExpression,
	right: ScalarExpression,
	operator: ComparisonOperator,
	type: Schema.Literal("comparison"),
});

export type Predicate =
	| ExistsExpression
	| typeof InPredicate.Type
	| typeof IsNullPredicate.Type
	| typeof ContainsPredicate.Type
	| typeof IsNotNullPredicate.Type
	| typeof ComparisonPredicate.Type
	| { readonly type: "not"; readonly predicate: Predicate }
	| { readonly type: "or"; readonly predicates: readonly Predicate[] }
	| { readonly type: "and"; readonly predicates: readonly Predicate[] };

export const Predicate: Schema.Codec<Predicate, unknown> = Schema.suspend(() =>
	Schema.Union([
		InPredicate,
		IsNullPredicate,
		ExistsExpression,
		ContainsPredicate,
		IsNotNullPredicate,
		ComparisonPredicate,
		strictStruct({ predicate: Predicate, type: Schema.Literal("not") }),
		strictStruct({ type: Schema.Literal("or"), predicates: Schema.Array(Predicate) }),
		strictStruct({ type: Schema.Literal("and"), predicates: Schema.Array(Predicate) }),
	]),
).annotate({ identifier: "RyotQLPredicate" });

export const Join = strictStruct({
	on: Predicate,
	table: TableReference,
	type: Schema.Literals(["inner", "left"]),
}).annotate({ identifier: "RyotQLJoin" });
export type Join = typeof Join.Type;

export const FieldSelection = strictStruct({
	key: Schema.String,
	expr: ScalarExpression,
}).annotate({ identifier: "RyotQLFieldSelection" });
export type FieldSelection = typeof FieldSelection.Type;

export const OrderBy = strictStruct({
	expr: ScalarExpression,
	direction: Schema.Literals(["asc", "desc"]),
}).annotate({ identifier: "RyotQLOrderBy" });
export type OrderBy = typeof OrderBy.Type;

export const AggregateMeasure = strictStruct({
	key: Schema.String,
	aggregation: AggregationSpec,
}).annotate({ identifier: "RyotQLAggregateMeasure" });
export type AggregateMeasure = typeof AggregateMeasure.Type;

export const AggregateOrderBy = strictStruct({
	key: Schema.String,
	direction: Schema.Literals(["asc", "desc"]),
}).annotate({ identifier: "RyotQLAggregateOrderBy" });
export type AggregateOrderBy = typeof AggregateOrderBy.Type;

export type Include = {
	readonly key: string;
	readonly limit: number;
	readonly from: TableReference;
	readonly where?: Predicate | undefined;
	readonly fields: readonly FieldSelection[];
	readonly orderBy: readonly [OrderBy, ...OrderBy[]];
	readonly joins?: readonly [Join, ...Join[]] | undefined;
	readonly include?: readonly [Include, ...Include[]] | undefined;
};

export const Include: Schema.Codec<Include, unknown> = Schema.suspend(() =>
	strictStruct({
		key: Schema.String,
		from: TableReference,
		where: Schema.optional(Predicate),
		fields: Schema.Array(FieldSelection),
		orderBy: Schema.NonEmptyArray(OrderBy),
		joins: Schema.optional(Schema.NonEmptyArray(Join)),
		include: Schema.optional(Schema.NonEmptyArray(Include)),
		limit: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
	}),
).annotate({ identifier: "RyotQLInclude" });

const Pagination = strictStruct({
	page: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
	limit: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
}).annotate({ identifier: "RyotQLPagination" });

export const RowsOutput = strictStruct({
	pagination: Pagination,
	orderBy: Schema.Array(OrderBy),
	type: Schema.Literal("rows"),
	fields: Schema.Array(FieldSelection),
	include: Schema.optional(Schema.NonEmptyArray(Include)),
}).annotate({ identifier: "RyotQLRowsOutput" });
export type RowsOutput = typeof RowsOutput.Type;

export const AggregateOutput = strictStruct({
	type: Schema.Literal("aggregate"),
	measures: Schema.NonEmptyArray(AggregateMeasure),
	groupBy: Schema.optional(Schema.Array(FieldSelection)),
	orderBy: Schema.optional(Schema.NonEmptyArray(AggregateOrderBy)),
	limit: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)))),
}).annotate({ identifier: "RyotQLAggregateOutput" });
export type AggregateOutput = typeof AggregateOutput.Type;

const TimeSeriesMeasure = strictStruct({
	aggregation: Schema.Union([
		strictStruct({ function: Schema.Literal("count") }),
		strictStruct({
			expr: ScalarExpression,
			function: Schema.Literals(["average", "maximum", "minimum", "sum"]),
		}),
	]),
}).annotate({ identifier: "RyotQLTimeSeriesMeasure" });

const TimeSeriesRange = strictStruct({
	endAt: Schema.String,
	startAt: Schema.String,
}).annotate({ identifier: "RyotQLTimeSeriesRange" });

const TimeSeriesTime = strictStruct({
	expr: ScalarExpression,
	range: TimeSeriesRange,
	bucket: Schema.Literals(["hour", "day", "week", "month"]),
}).annotate({ identifier: "RyotQLTimeSeriesTime" });

export const TimeSeriesOutput = strictStruct({
	time: TimeSeriesTime,
	measure: TimeSeriesMeasure,
	type: Schema.Literal("timeSeries"),
}).annotate({ identifier: "RyotQLTimeSeriesOutput" });
export type TimeSeriesOutput = typeof TimeSeriesOutput.Type;

export const NamedQuery = strictStruct({
	from: TableReference,
	where: Schema.optional(Predicate),
	joins: Schema.optional(Schema.NonEmptyArray(Join)),
	output: Schema.Union([RowsOutput, AggregateOutput, TimeSeriesOutput]),
}).annotate({ identifier: "RyotQLNamedQuery" });
export type NamedQuery = typeof NamedQuery.Type;

export const RyotQLDocument = strictStruct({
	queries: Schema.Record(Schema.String, NamedQuery),
}).annotate({ identifier: "RyotQLDocument" });
export type RyotQLDocument = typeof RyotQLDocument.Type;

export const FieldValue = strictStruct({
	value: Schema.Unknown,
	kind: Schema.Literals(["boolean", "date", "json", "null", "number", "text"]),
}).annotate({ identifier: "RyotQLFieldValue" });
export type FieldValue = typeof FieldValue.Type;

const IncludePageInfo = strictStruct({
	limit: Schema.Int,
	hasMore: Schema.Boolean,
}).annotate({ identifier: "RyotQLIncludePageInfo" });

export type IncludeResult = {
	readonly items: readonly RowItem[];
	readonly pageInfo: typeof IncludePageInfo.Type;
};
export type RowItem = Readonly<Record<string, FieldValue | IncludeResult>>;

const RowValue: Schema.Codec<FieldValue | IncludeResult, unknown> = Schema.suspend(() =>
	Schema.Union([
		FieldValue,
		strictStruct({
			pageInfo: IncludePageInfo,
			items: Schema.Array(Schema.Record(Schema.String, RowValue)),
		}),
	]),
).annotate({ identifier: "RyotQLRowValue" });

const RowsPageInfo = strictStruct({
	page: Schema.Int,
	limit: Schema.Int,
	total: Schema.Int,
	hasMore: Schema.Boolean,
}).annotate({ identifier: "RyotQLRowsPageInfo" });

export const RowsResult = strictStruct({
	pageInfo: RowsPageInfo,
	type: Schema.Literal("rows"),
	items: Schema.Array(Schema.Record(Schema.String, RowValue)),
}).annotate({ identifier: "RyotQLRowsResult" });
export type RowsResult = typeof RowsResult.Type;

export const AggregateResult = strictStruct({
	type: Schema.Literal("aggregate"),
	pageInfo: Schema.optional(IncludePageInfo),
	items: Schema.Array(Schema.Record(Schema.String, FieldValue)),
}).annotate({ identifier: "RyotQLAggregateResult" });
export type AggregateResult = typeof AggregateResult.Type;

const TimeSeriesBucket = strictStruct({
	value: Schema.Number,
	endAt: Schema.String,
	startAt: Schema.String,
}).annotate({ identifier: "RyotQLTimeSeriesBucket" });

export const TimeSeriesResult = strictStruct({
	type: Schema.Literal("timeSeries"),
	buckets: Schema.Array(TimeSeriesBucket),
}).annotate({ identifier: "RyotQLTimeSeriesResult" });
export type TimeSeriesResult = typeof TimeSeriesResult.Type;

export const RyotQLResult = Schema.Union([RowsResult, AggregateResult, TimeSeriesResult]).annotate({
	identifier: "RyotQLResult",
});
export type RyotQLResult = typeof RyotQLResult.Type;

export const RyotQLResponse = strictStruct({
	data: Schema.Record(Schema.String, RyotQLResult),
}).annotate({ identifier: "RyotQLResponse" });
export type RyotQLResponse = typeof RyotQLResponse.Type;
