import { Schema } from "effect";

import { ArithmeticOperator, ComparisonOperator } from "../../schema/operators";
import { strictStruct } from "../../schema/utils";

const SystemFieldSelector = strictStruct({
	name: Schema.String,
	type: Schema.Literal("system"),
}).annotate({ identifier: "SystemFieldSelector" });

const PropertyFieldSelector = strictStruct({
	schema: Schema.String,
	type: Schema.Literal("property"),
	path: Schema.NonEmptyArray(Schema.String),
}).annotate({ identifier: "PropertyFieldSelector" });

const SchemaMetadataFieldSelector = strictStruct({
	type: Schema.Literal("schema"),
	name: Schema.Literals(["slug", "name"]),
}).annotate({ identifier: "SchemaMetadataFieldSelector" });

// A server-derived value that is not a physical column: it is computed in SQL at read time. Valid
// on the root entity source only (see the validator). `translationStatus` reports the localization
// state of the row for the session language.
const SystemComputedFieldSelector = strictStruct({
	type: Schema.Literal("systemComputed"),
	name: Schema.Literal("translationStatus"),
}).annotate({ identifier: "SystemComputedFieldSelector" });

export const FieldSelector = Schema.Union([
	SystemFieldSelector,
	PropertyFieldSelector,
	SchemaMetadataFieldSelector,
	SystemComputedFieldSelector,
]).annotate({ identifier: "FieldSelector" });
export type FieldSelector = typeof FieldSelector.Type;

export type Expr =
	| { readonly type: "not"; readonly expr: Expr }
	| { readonly type: "isNull"; readonly expr: Expr }
	| { readonly type: "isNotNull"; readonly expr: Expr }
	| { readonly type: "measureRef"; readonly key: string }
	| { readonly type: "exists"; readonly source: Source }
	| { readonly type: "or"; readonly values: readonly [Expr, ...Expr[]] }
	| { readonly type: "and"; readonly values: readonly [Expr, ...Expr[]] }
	| { readonly type: "contains"; readonly left: Expr; readonly right: Expr }
	| { readonly type: "coalesce"; readonly values: readonly [Expr, ...Expr[]] }
	| { readonly type: "ref"; readonly sourceAlias: string; readonly field: FieldSelector }
	| { readonly type: "literal"; readonly value: unknown; readonly valueType?: "date" | undefined }
	| { readonly type: "aggregate"; readonly source: Source; readonly aggregation: AggregationSpec }
	| {
			type: "first";
			readonly select: Expr;
			readonly source: Source;
			readonly orderBy: readonly [typeof OrderByEntry.Type, ...Array<typeof OrderByEntry.Type>];
	  }
	| {
			readonly left: Expr;
			readonly right: Expr;
			readonly type: "arithmetic";
			readonly operator: ArithmeticOperator;
	  }
	| {
			readonly left: Expr;
			readonly right: Expr;
			readonly type: "comparison";
			readonly operator: ComparisonOperator;
	  };

export type AggregationSpec =
	| { readonly function: "count"; readonly distinctBy?: Expr | undefined }
	| { readonly function: "sum" | "average" | "minimum" | "maximum"; readonly expr: Expr };

const LiteralExpr = strictStruct({
	value: Schema.Unknown,
	type: Schema.Literal("literal"),
	valueType: Schema.optional(Schema.Literal("date")),
}).annotate({ identifier: "LiteralExpr" });

const RefExpr = strictStruct({
	field: FieldSelector,
	sourceAlias: Schema.String,
	type: Schema.Literal("ref"),
}).annotate({ identifier: "RefExpr" });

const MeasureRefExpr = strictStruct({
	key: Schema.String,
	type: Schema.Literal("measureRef"),
}).annotate({ identifier: "MeasureRefExpr" });

export const Expr: Schema.Codec<Expr, unknown> = Schema.suspend(() =>
	Schema.Union([
		RefExpr,
		LiteralExpr,
		MeasureRefExpr,
		strictStruct({ expr: Expr, type: Schema.Literal("not") }),
		strictStruct({ expr: Expr, type: Schema.Literal("isNull") }),
		strictStruct({ expr: Expr, type: Schema.Literal("isNotNull") }),
		strictStruct({ source: Source, type: Schema.Literal("exists") }),
		strictStruct({ left: Expr, right: Expr, type: Schema.Literal("contains") }),
		strictStruct({ type: Schema.Literal("or"), values: Schema.NonEmptyArray(Expr) }),
		strictStruct({ type: Schema.Literal("and"), values: Schema.NonEmptyArray(Expr) }),
		strictStruct({ type: Schema.Literal("coalesce"), values: Schema.NonEmptyArray(Expr) }),
		strictStruct({
			source: Source,
			aggregation: AggregationSpec,
			type: Schema.Literal("aggregate"),
		}),
		strictStruct({
			select: Expr,
			source: Source,
			type: Schema.Literal("first"),
			orderBy: Schema.NonEmptyArray(OrderByEntry),
		}),
		strictStruct({
			left: Expr,
			right: Expr,
			type: Schema.Literal("arithmetic"),
			operator: ArithmeticOperator,
		}),
		strictStruct({
			left: Expr,
			right: Expr,
			type: Schema.Literal("comparison"),
			operator: ComparisonOperator,
		}),
	]),
).annotate({ identifier: "Expr" });

const AggregationSpec: Schema.Codec<AggregationSpec, unknown> = Schema.suspend(() =>
	Schema.Union([
		strictStruct({ function: Schema.Literal("count"), distinctBy: Schema.optional(Expr) }),
		strictStruct({
			expr: Expr,
			function: Schema.Literals(["sum", "average", "minimum", "maximum"]),
		}),
	]),
).annotate({ identifier: "AggregationSpec" });

const RelationshipVia = strictStruct({
	alias: Schema.String,
	schema: Schema.String,
	entityRef: Schema.String,
	direction: Schema.Literals(["outgoing", "incoming"]),
}).annotate({ identifier: "RelationshipVia" });
export type RelationshipVia = typeof RelationshipVia.Type;

const EntitySource = strictStruct({
	alias: Schema.String,
	where: Schema.NullOr(Expr),
	type: Schema.Literal("entities"),
	schemas: Schema.NonEmptyArray(Schema.String),
	via: Schema.optional(RelationshipVia),
}).annotate({ identifier: "EntitySource" });
export type EntitySource = typeof EntitySource.Type;

const RootEventEntity = strictStruct({
	alias: Schema.String,
	schemas: Schema.NonEmptyArray(Schema.String),
}).annotate({ identifier: "RootEventEntity" });
export type RootEventEntity = typeof RootEventEntity.Type;

const NestedEventSource = strictStruct({
	alias: Schema.String,
	entityRef: Schema.String,
	type: Schema.Literal("events"),
	where: Schema.NullOr(Expr),
	schemas: Schema.NonEmptyArray(Schema.String),
}).annotate({ identifier: "NestedEventSource" });
export type NestedEventSource = typeof NestedEventSource.Type;

const RootEventSource = strictStruct({
	alias: Schema.String,
	entity: RootEventEntity,
	type: Schema.Literal("events"),
	where: Schema.NullOr(Expr),
	schemas: Schema.NonEmptyArray(Schema.String),
}).annotate({ identifier: "RootEventSource" });
export type RootEventSource = typeof RootEventSource.Type;

const EventSource = Schema.Union([NestedEventSource, RootEventSource]).annotate({
	identifier: "EventSource",
});
export type EventSource = typeof EventSource.Type;

const RelationshipEndpoint = strictStruct({
	alias: Schema.String,
	schemas: Schema.NonEmptyArray(Schema.String),
}).annotate({ identifier: "RelationshipEndpoint" });
export type RelationshipEndpoint = typeof RelationshipEndpoint.Type;

const RelationshipSource = strictStruct({
	alias: Schema.String,
	where: Schema.NullOr(Expr),
	sourceEntity: RelationshipEndpoint,
	targetEntity: RelationshipEndpoint,
	type: Schema.Literal("relationships"),
	schemas: Schema.NonEmptyArray(Schema.String),
}).annotate({ identifier: "RelationshipSource" });
export type RelationshipSource = typeof RelationshipSource.Type;

const Source = Schema.Union([EntitySource, NestedEventSource]).annotate({
	identifier: "Source",
});
export type Source = typeof Source.Type;

const RootSource = Schema.Union([EntitySource, RootEventSource, RelationshipSource]).annotate({
	identifier: "RootSource",
});
export type RootSource = typeof RootSource.Type;

const Pagination = strictStruct({
	page: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
	limit: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
}).annotate({ identifier: "Pagination" });

const OrderByEntry = strictStruct({ expr: Expr, order: Schema.Literals(["asc", "desc"]) }).annotate(
	{ identifier: "OrderByEntry" },
);
export type OrderByEntry = typeof OrderByEntry.Type;

const FieldDef = strictStruct({ expr: Expr, key: Schema.String }).annotate({
	identifier: "FieldDef",
});
export type FieldDef = typeof FieldDef.Type;

const AggregateMeasureDef = strictStruct({
	key: Schema.String,
	aggregation: AggregationSpec,
}).annotate({ identifier: "AggregateMeasureDef" });
export type AggregateMeasureDef = typeof AggregateMeasureDef.Type;

export type IncludeEntry = {
	readonly key: string;
	readonly limit: number;
	readonly source: EntitySource | NestedEventSource;
	readonly include?: readonly IncludeEntry[] | undefined;
	readonly fields: readonly (typeof FieldDef.Type)[];
	readonly orderBy: readonly [typeof OrderByEntry.Type, ...Array<typeof OrderByEntry.Type>];
};

const IncludeEntry: Schema.Codec<IncludeEntry, unknown> = Schema.suspend(() =>
	strictStruct({
		key: Schema.String,
		fields: Schema.Array(FieldDef),
		limit: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
		orderBy: Schema.NonEmptyArray(OrderByEntry),
		source: Schema.Union([EntitySource, NestedEventSource]),
		include: Schema.optional(Schema.Array(IncludeEntry)),
	}),
).annotate({ identifier: "IncludeEntry" });

export const RowsOutput = strictStruct({
	pagination: Pagination,
	type: Schema.Literal("rows"),
	fields: Schema.Array(FieldDef),
	orderBy: Schema.NonEmptyArray(OrderByEntry),
	include: Schema.optional(Schema.Array(IncludeEntry)),
}).annotate({ identifier: "RowsOutput" });
export type RowsOutput = typeof RowsOutput.Type;

const AggregateOutput = strictStruct({
	type: Schema.Literal("aggregate"),
	measures: Schema.NonEmptyArray(AggregateMeasureDef),
	groupBy: Schema.optional(Schema.Array(FieldDef)),
	limit: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)))),
	orderBy: Schema.optional(Schema.NonEmptyArray(OrderByEntry)),
}).annotate({ identifier: "AggregateOutput" });
export type AggregateOutput = typeof AggregateOutput.Type;

const TimeSeriesMeasureDef = strictStruct({
	aggregation: AggregationSpec,
}).annotate({ identifier: "TimeSeriesMeasureDef" });

const TimeSeriesRange = strictStruct({
	endAt: Schema.String,
	startAt: Schema.String,
}).annotate({ identifier: "TimeSeriesRange" });

const TimeSeriesTimeDef = strictStruct({
	expr: Expr,
	range: TimeSeriesRange,
	bucket: Schema.Literals(["hour", "day", "week", "month"]),
}).annotate({ identifier: "TimeSeriesTimeDef" });

const TimeSeriesOutput = strictStruct({
	time: TimeSeriesTimeDef,
	measure: TimeSeriesMeasureDef,
	type: Schema.Literal("timeSeries"),
}).annotate({ identifier: "TimeSeriesOutput" });
export type TimeSeriesOutput = typeof TimeSeriesOutput.Type;

const Output = Schema.Union([RowsOutput, AggregateOutput, TimeSeriesOutput]).annotate({
	identifier: "Output",
});
export type Output = typeof Output.Type;

export const QueryDocument = strictStruct({ output: Output, source: RootSource }).annotate({
	identifier: "QueryDocument",
});
export type QueryDocument = typeof QueryDocument.Type;

const FieldValue = strictStruct({
	value: Schema.Unknown,
	kind: Schema.Literals(["boolean", "date", "json", "null", "number", "text"]),
}).annotate({ identifier: "FieldValue" });
export type FieldValue = typeof FieldValue.Type;

const LimitedPageInfo = strictStruct({ limit: Schema.Int, hasMore: Schema.Boolean }).annotate({
	identifier: "LimitedPageInfo",
});

export type IncludedRowsValue = {
	readonly items: readonly RowItem[];
	readonly pageInfo: typeof LimitedPageInfo.Type;
};

export type RowValue = FieldValue | IncludedRowsValue;
export type RowItem = Readonly<Record<string, RowValue>>;

const RowValue: Schema.Codec<RowValue, unknown> = Schema.suspend(() =>
	Schema.Union([
		FieldValue,
		strictStruct({
			pageInfo: LimitedPageInfo,
			items: Schema.Array(Schema.Record(Schema.String, RowValue)),
		}),
	]),
).annotate({ identifier: "RowValue" });

const RowsPageInfo = strictStruct({
	page: Schema.Int,
	limit: Schema.Int,
	total: Schema.Int,
	hasMore: Schema.Boolean,
}).annotate({ identifier: "RowsPageInfo" });

const RowsResponse = strictStruct({
	type: Schema.Literal("rows"),
	data: strictStruct({
		pageInfo: RowsPageInfo,
		items: Schema.Array(Schema.Record(Schema.String, RowValue)),
	}),
}).annotate({ identifier: "RowsResponse" });
export type RowsResponse = typeof RowsResponse.Type;

const AggregateResponse = strictStruct({
	type: Schema.Literal("aggregate"),
	data: strictStruct({
		pageInfo: Schema.optional(LimitedPageInfo),
		items: Schema.Array(Schema.Record(Schema.String, RowValue)),
	}),
}).annotate({ identifier: "AggregateResponse" });
export type AggregateResponse = typeof AggregateResponse.Type;

const TimeSeriesBucket = strictStruct({
	value: Schema.Number,
	endAt: Schema.String,
	startAt: Schema.String,
}).annotate({ identifier: "TimeSeriesBucket" });

const TimeSeriesResponse = strictStruct({
	type: Schema.Literal("timeSeries"),
	data: strictStruct({ buckets: Schema.Array(TimeSeriesBucket) }),
}).annotate({ identifier: "TimeSeriesResponse" });
export type TimeSeriesResponse = typeof TimeSeriesResponse.Type;

export const QueryResponse = Schema.Union([
	RowsResponse,
	AggregateResponse,
	TimeSeriesResponse,
]).annotate({ identifier: "QueryResponse" });
export type QueryResponse = typeof QueryResponse.Type;
