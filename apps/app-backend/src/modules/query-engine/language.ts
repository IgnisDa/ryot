import { Schema } from "effect";

import { ArithmeticOperator, ComparisonOperator } from "#lib/schema/operators";
import { strictStruct } from "#lib/schema/utils";

const SystemFieldSelector = strictStruct({
	name: Schema.String,
	type: Schema.Literal("system"),
}).annotations({ identifier: "SystemFieldSelector" });

const PropertyFieldSelector = strictStruct({
	schema: Schema.String,
	type: Schema.Literal("property"),
	path: Schema.NonEmptyArray(Schema.String),
}).annotations({ identifier: "PropertyFieldSelector" });

const SchemaMetadataFieldSelector = strictStruct({
	type: Schema.Literal("schema"),
	name: Schema.Literal("slug", "name", "isBuiltin"),
}).annotations({ identifier: "SchemaMetadataFieldSelector" });

export const FieldSelector = Schema.Union(
	SystemFieldSelector,
	PropertyFieldSelector,
	SchemaMetadataFieldSelector,
).annotations({ identifier: "FieldSelector" });
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
	| { readonly type: "literal"; readonly value: unknown; readonly valueType?: "date" }
	| { readonly type: "ref"; readonly sourceAlias: string; readonly field: FieldSelector }
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
	| { readonly function: "count"; readonly distinctBy?: Expr }
	| { readonly function: "sum" | "average" | "minimum" | "maximum"; readonly expr: Expr };

const LiteralExpr = strictStruct({
	value: Schema.Unknown,
	type: Schema.Literal("literal"),
	valueType: Schema.optional(Schema.Literal("date")),
}).annotations({ identifier: "LiteralExpr" });

const RefExpr = strictStruct({
	field: FieldSelector,
	sourceAlias: Schema.String,
	type: Schema.Literal("ref"),
}).annotations({ identifier: "RefExpr" });

const MeasureRefExpr = strictStruct({
	key: Schema.String,
	type: Schema.Literal("measureRef"),
}).annotations({ identifier: "MeasureRefExpr" });

export const Expr: Schema.Schema<Expr> = Schema.suspend(() =>
	Schema.Union(
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
	),
).annotations({ identifier: "Expr" });

const AggregationSpec: Schema.Schema<AggregationSpec> = Schema.suspend(() =>
	Schema.Union(
		strictStruct({ function: Schema.Literal("count"), distinctBy: Schema.optional(Expr) }),
		strictStruct({ expr: Expr, function: Schema.Literal("sum", "average", "minimum", "maximum") }),
	),
).annotations({ identifier: "AggregationSpec" });

const RelationshipVia = strictStruct({
	alias: Schema.String,
	schema: Schema.String,
	entityRef: Schema.String,
	direction: Schema.Literal("outgoing", "incoming"),
}).annotations({ identifier: "RelationshipVia" });
export type RelationshipVia = typeof RelationshipVia.Type;

const EntitySource = strictStruct({
	alias: Schema.String,
	where: Schema.NullOr(Expr),
	type: Schema.Literal("entities"),
	schemas: Schema.NonEmptyArray(Schema.String),
	via: Schema.optional(RelationshipVia),
}).annotations({ identifier: "EntitySource" });
export type EntitySource = typeof EntitySource.Type;

const RootEventEntity = strictStruct({
	alias: Schema.String,
	schemas: Schema.NonEmptyArray(Schema.String),
}).annotations({ identifier: "RootEventEntity" });
export type RootEventEntity = typeof RootEventEntity.Type;

const NestedEventSource = strictStruct({
	alias: Schema.String,
	entityRef: Schema.String,
	type: Schema.Literal("events"),
	where: Schema.NullOr(Expr),
	schemas: Schema.NonEmptyArray(Schema.String),
}).annotations({ identifier: "NestedEventSource" });
export type NestedEventSource = typeof NestedEventSource.Type;

const RootEventSource = strictStruct({
	alias: Schema.String,
	entity: RootEventEntity,
	type: Schema.Literal("events"),
	where: Schema.NullOr(Expr),
	schemas: Schema.NonEmptyArray(Schema.String),
}).annotations({ identifier: "RootEventSource" });
export type RootEventSource = typeof RootEventSource.Type;

const EventSource = Schema.Union(NestedEventSource, RootEventSource).annotations({
	identifier: "EventSource",
});
export type EventSource = typeof EventSource.Type;

const RelationshipEndpoint = strictStruct({
	alias: Schema.String,
	schemas: Schema.NonEmptyArray(Schema.String),
}).annotations({ identifier: "RelationshipEndpoint" });
export type RelationshipEndpoint = typeof RelationshipEndpoint.Type;

const RelationshipSource = strictStruct({
	alias: Schema.String,
	where: Schema.NullOr(Expr),
	sourceEntity: RelationshipEndpoint,
	targetEntity: RelationshipEndpoint,
	type: Schema.Literal("relationships"),
	schemas: Schema.NonEmptyArray(Schema.String),
}).annotations({ identifier: "RelationshipSource" });
export type RelationshipSource = typeof RelationshipSource.Type;

const Source = Schema.Union(EntitySource, NestedEventSource).annotations({
	identifier: "Source",
});
export type Source = typeof Source.Type;

const RootSource = Schema.Union(EntitySource, RootEventSource, RelationshipSource).annotations({
	identifier: "RootSource",
});
export type RootSource = typeof RootSource.Type;

const Pagination = strictStruct({
	page: Schema.Int.pipe(Schema.positive()),
	limit: Schema.Int.pipe(Schema.positive()),
}).annotations({ identifier: "Pagination" });

const OrderByEntry = strictStruct({ expr: Expr, order: Schema.Literal("asc", "desc") }).annotations(
	{ identifier: "OrderByEntry" },
);

const FieldDef = strictStruct({ expr: Expr, key: Schema.String }).annotations({
	identifier: "FieldDef",
});
export type FieldDef = typeof FieldDef.Type;

const AggregateMeasureDef = strictStruct({
	key: Schema.String,
	aggregation: AggregationSpec,
}).annotations({ identifier: "AggregateMeasureDef" });
export type AggregateMeasureDef = typeof AggregateMeasureDef.Type;

export type IncludeEntry = {
	readonly key: string;
	readonly limit: number;
	readonly source: EntitySource | NestedEventSource;
	readonly include?: readonly IncludeEntry[];
	readonly fields: readonly (typeof FieldDef.Type)[];
	readonly orderBy: readonly [typeof OrderByEntry.Type, ...Array<typeof OrderByEntry.Type>];
};

const IncludeEntry: Schema.Schema<IncludeEntry> = Schema.suspend(() =>
	strictStruct({
		key: Schema.String,
		fields: Schema.Array(FieldDef),
		limit: Schema.Int.pipe(Schema.positive()),
		orderBy: Schema.NonEmptyArray(OrderByEntry),
		source: Schema.Union(EntitySource, NestedEventSource),
		include: Schema.optional(Schema.Array(IncludeEntry)),
	}),
).annotations({ identifier: "IncludeEntry" });

export const RowsOutput = strictStruct({
	pagination: Pagination,
	type: Schema.Literal("rows"),
	fields: Schema.Array(FieldDef),
	orderBy: Schema.NonEmptyArray(OrderByEntry),
	include: Schema.optional(Schema.Array(IncludeEntry)),
}).annotations({ identifier: "RowsOutput" });
export type RowsOutput = typeof RowsOutput.Type;

const AggregateOutput = strictStruct({
	type: Schema.Literal("aggregate"),
	measures: Schema.NonEmptyArray(AggregateMeasureDef),
	groupBy: Schema.optional(Schema.Array(FieldDef)),
	limit: Schema.optional(Schema.Int.pipe(Schema.positive())),
	orderBy: Schema.optional(Schema.NonEmptyArray(OrderByEntry)),
}).annotations({ identifier: "AggregateOutput" });
export type AggregateOutput = typeof AggregateOutput.Type;

const TimeSeriesMeasureDef = strictStruct({
	aggregation: AggregationSpec,
}).annotations({ identifier: "TimeSeriesMeasureDef" });

const TimeSeriesRange = strictStruct({
	endAt: Schema.String,
	startAt: Schema.String,
}).annotations({ identifier: "TimeSeriesRange" });

const TimeSeriesTimeDef = strictStruct({
	expr: Expr,
	range: TimeSeriesRange,
	bucket: Schema.Literal("hour", "day", "week", "month"),
}).annotations({ identifier: "TimeSeriesTimeDef" });

const TimeSeriesOutput = strictStruct({
	time: TimeSeriesTimeDef,
	measure: TimeSeriesMeasureDef,
	type: Schema.Literal("timeSeries"),
}).annotations({ identifier: "TimeSeriesOutput" });
export type TimeSeriesOutput = typeof TimeSeriesOutput.Type;

const Output = Schema.Union(RowsOutput, AggregateOutput, TimeSeriesOutput).annotations({
	identifier: "Output",
});
export type Output = typeof Output.Type;

export const QueryDocument = strictStruct({ output: Output, source: RootSource }).annotations({
	identifier: "QueryDocument",
});
export type QueryDocument = typeof QueryDocument.Type;

const FieldValue = strictStruct({
	value: Schema.Unknown,
	kind: Schema.Literal("boolean", "date", "image", "json", "null", "number", "text"),
}).annotations({ identifier: "FieldValue" });
export type FieldValue = typeof FieldValue.Type;

const LimitedPageInfo = strictStruct({ limit: Schema.Int, hasMore: Schema.Boolean }).annotations({
	identifier: "LimitedPageInfo",
});

export type IncludedRowsValue = {
	readonly items: readonly RowItem[];
	readonly pageInfo: typeof LimitedPageInfo.Type;
};

export type RowValue = FieldValue | IncludedRowsValue;
export type RowItem = Readonly<Record<string, RowValue>>;

const RowValue: Schema.Schema<RowValue> = Schema.suspend(() =>
	Schema.Union(
		FieldValue,
		strictStruct({
			pageInfo: LimitedPageInfo,
			items: Schema.Array(Schema.Record({ key: Schema.String, value: RowValue })),
		}),
	),
).annotations({ identifier: "RowValue" });

const RowsPageInfo = strictStruct({
	page: Schema.Int,
	limit: Schema.Int,
	total: Schema.Int,
	hasMore: Schema.Boolean,
}).annotations({ identifier: "RowsPageInfo" });

const RowsResponse = strictStruct({
	type: Schema.Literal("rows"),
	data: strictStruct({
		pageInfo: RowsPageInfo,
		items: Schema.Array(Schema.Record({ key: Schema.String, value: RowValue })),
	}),
}).annotations({ identifier: "RowsResponse" });
export type RowsResponse = typeof RowsResponse.Type;

const AggregateResponse = strictStruct({
	type: Schema.Literal("aggregate"),
	data: strictStruct({
		pageInfo: Schema.optional(LimitedPageInfo),
		items: Schema.Array(Schema.Record({ key: Schema.String, value: RowValue })),
	}),
}).annotations({ identifier: "AggregateResponse" });
export type AggregateResponse = typeof AggregateResponse.Type;

const TimeSeriesBucket = strictStruct({
	value: Schema.Number,
	endAt: Schema.String,
	startAt: Schema.String,
}).annotations({ identifier: "TimeSeriesBucket" });

const TimeSeriesResponse = strictStruct({
	type: Schema.Literal("timeSeries"),
	data: strictStruct({ buckets: Schema.Array(TimeSeriesBucket) }),
}).annotations({ identifier: "TimeSeriesResponse" });
export type TimeSeriesResponse = typeof TimeSeriesResponse.Type;

export const QueryResponse = Schema.Union(
	RowsResponse,
	AggregateResponse,
	TimeSeriesResponse,
).annotations({ identifier: "QueryResponse" });
export type QueryResponse = typeof QueryResponse.Type;
