import { Schema } from "effect";

import { JsonValue } from "../../schema/json";
import { strictStruct } from "../../schema/utils";
import { PluginIdentityReference } from "../plugins/references";

export const TableReference = strictStruct({ alias: Schema.String, table: Schema.String }).annotate(
	{ identifier: "RyotQLTableReference" },
);
export type TableReference = typeof TableReference.Type;

export const ColumnExpression = strictStruct({
	field: Schema.String,
	tableAlias: Schema.String,
	type: Schema.Literal("column"),
}).annotate({ identifier: "RyotQLColumnExpression" });
export type ColumnExpression = typeof ColumnExpression.Type;

export const LiteralExpression = strictStruct({
	value: JsonValue,
	type: Schema.Literal("literal"),
}).annotate({ identifier: "RyotQLLiteralExpression" });
export type LiteralExpression = typeof LiteralExpression.Type;

export const PluginIdExpression = strictStruct({
	type: Schema.Literal("pluginId"),
	reference: PluginIdentityReference,
}).annotate({ identifier: "RyotQLPluginIdExpression" });
export type PluginIdExpression = typeof PluginIdExpression.Type;

const JsonPathSegment = Schema.Union([Schema.String, Schema.Finite]);
const CastTarget = Schema.Literals(["boolean", "date", "json", "number", "text"]);
const JsonPath = Schema.NonEmptyArray(JsonPathSegment);
const TransformName = Schema.Literals(["kebabCase", "titleCase"]);
const DateBucketUnit = Schema.Literals(["hour", "day", "week", "month"]);

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

export type ExistsExpression = { readonly type: "exists"; readonly query: CorrelatedQuerySet };

export type JsonElementExpression = { readonly type: "jsonElement" };

export type CurrentDateExpression = { readonly type: "currentDate" };

export type JsonArrayExistsExpression = {
	readonly type: "jsonExists";
	readonly array: ScalarExpression;
	readonly where?: Predicate | undefined;
};

export type JsonArrayFirstExpression = {
	readonly type: "jsonFirst";
	readonly array: ScalarExpression;
	readonly select: ScalarExpression;
	readonly orderBy: readonly [OrderBy, ...OrderBy[]];
	readonly where?: Predicate | undefined;
};

export type JsonArrayCountExpression = {
	readonly type: "jsonCount";
	readonly array: ScalarExpression;
	readonly where?: Predicate | undefined;
};

export type ScalarExpression =
	| ColumnExpression
	| CurrentDateExpression
	| ExistsExpression
	| JsonArrayCountExpression
	| JsonArrayExistsExpression
	| JsonArrayFirstExpression
	| JsonElementExpression
	| LiteralExpression
	| PluginIdExpression
	| { readonly type: "floor"; readonly expr: ScalarExpression }
	| { readonly type: "round"; readonly expr: ScalarExpression }
	| { readonly type: "integer"; readonly expr: ScalarExpression }
	| { readonly type: "isNotNull"; readonly expr: ScalarExpression }
	| {
			readonly type: "coalesce";
			readonly values: readonly [ScalarExpression, ...ScalarExpression[]];
	  }
	| { readonly type: "concat"; readonly values: readonly [ScalarExpression, ...ScalarExpression[]] }
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
			readonly timeZone: string;
			readonly type: "dateBucket";
			readonly expr: ScalarExpression;
			readonly bucket: typeof DateBucketUnit.Type;
	  }
	| {
			readonly type: "conditional";
			readonly condition: Predicate;
			readonly whenTrue: ScalarExpression;
			readonly whenFalse: ScalarExpression;
	  }
	| {
			readonly type: "transform";
			readonly expr: ScalarExpression;
			readonly name: typeof TransformName.Type;
	  }
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

export const JsonElementExpression: Schema.Codec<JsonElementExpression, unknown> = strictStruct({
	type: Schema.Literal("jsonElement"),
}).annotate({ identifier: "RyotQLJsonElementExpression" });

export const CurrentDateExpression: Schema.Codec<CurrentDateExpression, unknown> = strictStruct({
	type: Schema.Literal("currentDate"),
}).annotate({ identifier: "RyotQLCurrentDateExpression" });

export const ScalarExpression: Schema.Codec<ScalarExpression, unknown> = Schema.suspend(() =>
	Schema.Union([
		ColumnExpression,
		LiteralExpression,
		PluginIdExpression,
		ExistsExpression,
		JsonElementExpression,
		CurrentDateExpression,
		JsonArrayExistsExpression,
		JsonArrayFirstExpression,
		JsonArrayCountExpression,
		strictStruct({
			type: Schema.Literal("coalesce"),
			values: Schema.NonEmptyArray(ScalarExpression),
		}),
		strictStruct({
			type: Schema.Literal("concat"),
			values: Schema.NonEmptyArray(ScalarExpression),
		}),
		strictStruct({
			condition: Predicate,
			whenTrue: ScalarExpression,
			whenFalse: ScalarExpression,
			type: Schema.Literal("conditional"),
		}),
		strictStruct({ target: CastTarget, expr: ScalarExpression, type: Schema.Literal("cast") }),
		strictStruct({
			name: TransformName,
			expr: ScalarExpression,
			type: Schema.Literal("transform"),
		}),
		strictStruct({ expr: ScalarExpression, type: Schema.Literal("floor") }),
		strictStruct({ expr: ScalarExpression, type: Schema.Literal("integer") }),
		strictStruct({ expr: ScalarExpression, type: Schema.Literal("isNotNull") }),
		strictStruct({ expr: ScalarExpression, type: Schema.Literal("round") }),
		strictStruct({
			expr: ScalarExpression,
			bucket: DateBucketUnit,
			timeZone: Schema.String,
			type: Schema.Literal("dateBucket"),
		}),
		strictStruct({ path: JsonPath, expr: ScalarExpression, type: Schema.Literal("jsonPath") }),
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
			select: ScalarExpression,
			query: CorrelatedQuerySet,
			type: Schema.Literal("first"),
			orderBy: Schema.NonEmptyArray(OrderBy),
		}),
	]),
).annotate({ identifier: "RyotQLScalarExpression" });

const IsNullPredicate = strictStruct({ expr: ScalarExpression, type: Schema.Literal("isNull") });

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
	| JsonArrayExistsExpression
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
		JsonArrayExistsExpression,
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

export const OutputFieldKey = Schema.NonEmptyString.annotate({
	identifier: "RyotQLOutputFieldKey",
});
export type OutputFieldKey = typeof OutputFieldKey.Type;

export const FieldSelection = strictStruct({
	key: OutputFieldKey,
	expr: ScalarExpression,
}).annotate({ identifier: "RyotQLFieldSelection" });
export type FieldSelection = typeof FieldSelection.Type;

export const WildcardSelection = strictStruct({
	tableAlias: Schema.String,
	type: Schema.Literal("wildcard"),
}).annotate({ identifier: "RyotQLWildcardSelection" });
export type WildcardSelection = typeof WildcardSelection.Type;

export const RowSelection = Schema.Union([FieldSelection, WildcardSelection]).annotate({
	identifier: "RyotQLRowSelection",
});
export type RowSelection = typeof RowSelection.Type;

export const OrderBy = strictStruct({
	expr: ScalarExpression,
	direction: Schema.Literals(["asc", "desc"]),
}).annotate({ identifier: "RyotQLOrderBy" });
export type OrderBy = typeof OrderBy.Type;

export const JsonArrayExistsExpression: Schema.Codec<JsonArrayExistsExpression, unknown> =
	Schema.suspend(() =>
		strictStruct({
			array: ScalarExpression,
			where: Schema.optional(Predicate),
			type: Schema.Literal("jsonExists"),
		}),
	).annotate({ identifier: "RyotQLJsonArrayExistsExpression" });

export const JsonArrayFirstExpression: Schema.Codec<JsonArrayFirstExpression, unknown> =
	Schema.suspend(() =>
		strictStruct({
			array: ScalarExpression,
			select: ScalarExpression,
			where: Schema.optional(Predicate),
			type: Schema.Literal("jsonFirst"),
			orderBy: Schema.NonEmptyArray(OrderBy),
		}),
	).annotate({ identifier: "RyotQLJsonArrayFirstExpression" });

export const JsonArrayCountExpression: Schema.Codec<JsonArrayCountExpression, unknown> =
	Schema.suspend(() =>
		strictStruct({
			array: ScalarExpression,
			where: Schema.optional(Predicate),
			type: Schema.Literal("jsonCount"),
		}),
	).annotate({ identifier: "RyotQLJsonArrayCountExpression" });

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
	readonly fields: readonly RowSelection[];
	readonly orderBy: readonly [OrderBy, ...OrderBy[]];
	readonly joins?: readonly [Join, ...Join[]] | undefined;
	readonly include?: readonly [Include, ...Include[]] | undefined;
};

export const Include: Schema.Codec<Include, unknown> = Schema.suspend(() =>
	strictStruct({
		key: Schema.String,
		from: TableReference,
		where: Schema.optional(Predicate),
		fields: Schema.Array(RowSelection),
		orderBy: Schema.NonEmptyArray(OrderBy),
		joins: Schema.optional(Schema.NonEmptyArray(Join)),
		include: Schema.optional(Schema.NonEmptyArray(Include)),
		limit: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
	}),
).annotate({ identifier: "RyotQLInclude" });

export const Pagination = strictStruct({
	after: Schema.optional(Schema.NonEmptyString),
	limit: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
}).annotate({ identifier: "RyotQLPagination" });
export type Pagination = typeof Pagination.Type;

export const RowsOutput = strictStruct({
	pagination: Pagination,
	type: Schema.Literal("rows"),
	orderBy: Schema.Array(OrderBy),
	fields: Schema.Array(RowSelection),
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

const TimeSeriesRange = strictStruct({ endAt: Schema.String, startAt: Schema.String }).annotate({
	identifier: "RyotQLTimeSeriesRange",
});

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

const mapNonEmpty = <A, B>(
	values: readonly [A, ...A[]],
	transform: (value: A) => B,
): readonly [B, ...B[]] => [transform(values[0]), ...values.slice(1).map(transform)];

export const mapPluginIdentityReferences = (
	document: RyotQLDocument,
	transform: (reference: PluginIdentityReference) => PluginIdentityReference,
): RyotQLDocument => {
	const aggregation = (value: AggregationSpec): AggregationSpec =>
		value.function === "count" ? value : { ...value, expr: expression(value.expr) };
	const ordering = (value: OrderBy): OrderBy => ({ ...value, expr: expression(value.expr) });
	const field = (value: FieldSelection): FieldSelection => ({
		...value,
		expr: expression(value.expr),
	});
	const selection = (value: RowSelection): RowSelection => ("expr" in value ? field(value) : value);
	const join = (value: Join): Join => ({ ...value, on: predicate(value.on) });
	const querySet = <A extends CorrelatedQuerySet>(value: A) => ({
		...value,
		...(value.where === undefined ? {} : { where: predicate(value.where) }),
		...(value.joins === undefined ? {} : { joins: mapNonEmpty(value.joins, join) }),
	});
	function expression(value: ScalarExpression): ScalarExpression {
		switch (value.type) {
			case "pluginId":
				return { ...value, reference: transform(value.reference) };
			case "column":
			case "literal":
			case "currentDate":
			case "jsonElement":
				return value;
			case "cast":
			case "dateBucket":
			case "floor":
			case "integer":
			case "isNotNull":
			case "jsonPath":
			case "round":
			case "transform":
				return { ...value, expr: expression(value.expr) };
			case "coalesce":
			case "concat":
				return { ...value, values: mapNonEmpty(value.values, expression) };
			case "arithmetic":
				return { ...value, left: expression(value.left), right: expression(value.right) };
			case "conditional":
				return {
					...value,
					whenTrue: expression(value.whenTrue),
					condition: predicate(value.condition),
					whenFalse: expression(value.whenFalse),
				};
			case "exists":
				return { ...value, query: querySet(value.query) };
			case "aggregate":
				return {
					...value,
					query: querySet(value.query),
					aggregation: aggregation(value.aggregation),
				};
			case "first":
				return {
					...value,
					query: querySet(value.query),
					select: expression(value.select),
					orderBy: mapNonEmpty(value.orderBy, ordering),
				};
			case "jsonCount":
			case "jsonExists":
				return {
					...value,
					array: expression(value.array),
					...(value.where === undefined ? {} : { where: predicate(value.where) }),
				};
			case "jsonFirst":
				return {
					...value,
					array: expression(value.array),
					select: expression(value.select),
					orderBy: mapNonEmpty(value.orderBy, ordering),
					...(value.where === undefined ? {} : { where: predicate(value.where) }),
				};
			default:
				throw new Error(`Unknown RyotQL expression: ${String(value satisfies never)}`);
		}
	}
	function predicate(value: Predicate): Predicate {
		switch (value.type) {
			case "and":
			case "or":
				return { ...value, predicates: value.predicates.map(predicate) };
			case "not":
				return { ...value, predicate: predicate(value.predicate) };
			case "comparison":
			case "contains":
				return { ...value, left: expression(value.left), right: expression(value.right) };
			case "in":
				return { ...value, expr: expression(value.expr), values: value.values.map(expression) };
			case "isNull":
			case "isNotNull":
				return { ...value, expr: expression(value.expr) };
			case "exists":
				return { ...value, query: querySet(value.query) };
			case "jsonExists":
				return {
					...value,
					array: expression(value.array),
					...(value.where === undefined ? {} : { where: predicate(value.where) }),
				};
			default:
				throw new Error(`Unknown RyotQL predicate: ${String(value satisfies never)}`);
		}
	}
	const include = (value: Include): Include => ({
		...querySet(value),
		fields: value.fields.map(selection),
		orderBy: mapNonEmpty(value.orderBy, ordering),
		...(value.include === undefined ? {} : { include: mapNonEmpty(value.include, include) }),
	});
	function query(value: NamedQuery): NamedQuery {
		const output = value.output;
		switch (output.type) {
			case "rows":
				return {
					...querySet(value),
					output: {
						...output,
						fields: output.fields.map(selection),
						orderBy: output.orderBy.map(ordering),
						...(output.include === undefined
							? {}
							: { include: mapNonEmpty(output.include, include) }),
					},
				};
			case "aggregate":
				return {
					...querySet(value),
					output: {
						...output,
						measures: mapNonEmpty(output.measures, (measure) => ({
							...measure,
							aggregation: aggregation(measure.aggregation),
						})),
						...(output.groupBy === undefined ? {} : { groupBy: output.groupBy.map(field) }),
					},
				};
			case "timeSeries":
				return {
					...querySet(value),
					output: {
						...output,
						time: { ...output.time, expr: expression(output.time.expr) },
						measure: {
							aggregation:
								output.measure.aggregation.function === "count"
									? output.measure.aggregation
									: {
											...output.measure.aggregation,
											expr: expression(output.measure.aggregation.expr),
										},
						},
					},
				};
			default:
				throw new Error(`Unknown RyotQL output: ${String(output satisfies never)}`);
		}
	}
	return {
		queries: Object.fromEntries(
			Object.entries(document.queries).map(([name, value]) => [name, query(value)]),
		),
	};
};

const IncludePageInfo = strictStruct({ limit: Schema.Int, hasMore: Schema.Boolean }).annotate({
	identifier: "RyotQLIncludePageInfo",
});

export type IncludeResult = {
	readonly items: readonly RowItem[];
	readonly pageInfo: typeof IncludePageInfo.Type;
};
export type RowItem = Readonly<Record<string, unknown>>;

const ResultValue: Schema.Codec<unknown, unknown> = Schema.suspend(() =>
	Schema.Union([
		JsonValue,
		strictStruct({
			pageInfo: IncludePageInfo,
			items: Schema.Array(Schema.Record(Schema.String, ResultValue)),
		}),
	]),
);

export const RowsPageInfo = strictStruct({
	limit: Schema.Int,
	hasMore: Schema.Boolean,
	nextCursor: Schema.NullOr(Schema.String),
}).annotate({ identifier: "RyotQLRowsPageInfo" });

export const rowsResultSchema = <A, I>(item: Schema.Codec<A, I>) =>
	strictStruct({ pageInfo: RowsPageInfo, items: Schema.Array(item), type: Schema.Literal("rows") });

export const RowsResult = rowsResultSchema(Schema.Record(Schema.String, ResultValue)).annotate({
	identifier: "RyotQLRowsResult",
});
export type RowsResult = typeof RowsResult.Type;

export const AggregateResult = strictStruct({
	type: Schema.Literal("aggregate"),
	pageInfo: Schema.optional(IncludePageInfo),
	items: Schema.Array(Schema.Record(Schema.String, JsonValue)),
}).annotate({ identifier: "RyotQLAggregateResult" });
export type AggregateResult = typeof AggregateResult.Type;

const TimeSeriesBucket = strictStruct({
	value: Schema.Finite,
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
