import { Schema } from "effect";

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
	name: Schema.Literal("slug", "name"),
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
	| { readonly type: "exists"; readonly source: SourceV2 }
	| { readonly type: "or"; readonly values: readonly [Expr, ...Expr[]] }
	| { readonly type: "and"; readonly values: readonly [Expr, ...Expr[]] }
	| { readonly type: "contains"; readonly left: Expr; readonly right: Expr }
	| { readonly type: "coalesce"; readonly values: readonly [Expr, ...Expr[]] }
	| { readonly type: "literal"; readonly value: unknown; readonly valueType?: "date" }
	| { readonly type: "ref"; readonly sourceAlias: string; readonly field: FieldSelector }
	| { readonly type: "aggregate"; readonly source: SourceV2; readonly aggregation: AggregationSpec }
	| {
			type: "first";
			readonly select: Expr;
			readonly source: SourceV2;
			readonly orderBy: readonly [typeof OrderByEntry.Type, ...Array<typeof OrderByEntry.Type>];
	  }
	| {
			readonly left: Expr;
			readonly right: Expr;
			readonly type: "comparison";
			readonly operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
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
		strictStruct({ source: SourceV2, type: Schema.Literal("exists") }),
		strictStruct({ left: Expr, right: Expr, type: Schema.Literal("contains") }),
		strictStruct({ type: Schema.Literal("or"), values: Schema.NonEmptyArray(Expr) }),
		strictStruct({ type: Schema.Literal("and"), values: Schema.NonEmptyArray(Expr) }),
		strictStruct({ type: Schema.Literal("coalesce"), values: Schema.NonEmptyArray(Expr) }),
		strictStruct({
			source: SourceV2,
			aggregation: AggregationSpec,
			type: Schema.Literal("aggregate"),
		}),
		strictStruct({
			select: Expr,
			source: SourceV2,
			type: Schema.Literal("first"),
			orderBy: Schema.NonEmptyArray(OrderByEntry),
		}),
		strictStruct({
			left: Expr,
			right: Expr,
			type: Schema.Literal("comparison"),
			operator: Schema.Literal("eq", "neq", "gt", "gte", "lt", "lte"),
		}),
	),
).annotations({ identifier: "Expr" });

export const AggregationSpec: Schema.Schema<AggregationSpec> = Schema.suspend(() =>
	Schema.Union(
		strictStruct({ function: Schema.Literal("count"), distinctBy: Schema.optional(Expr) }),
		strictStruct({ expr: Expr, function: Schema.Literal("sum", "average", "minimum", "maximum") }),
	),
).annotations({ identifier: "AggregationSpec" });

const RelationshipViaV2 = strictStruct({
	alias: Schema.String,
	schema: Schema.String,
	entityRef: Schema.String,
	direction: Schema.Literal("outgoing", "incoming"),
}).annotations({ identifier: "RelationshipViaV2" });
export type RelationshipViaV2 = typeof RelationshipViaV2.Type;

export const EntitySourceV2 = strictStruct({
	alias: Schema.String,
	where: Schema.NullOr(Expr),
	type: Schema.Literal("entities"),
	schemas: Schema.NonEmptyArray(Schema.String),
	via: Schema.optional(RelationshipViaV2),
}).annotations({ identifier: "EntitySourceV2" });
export type EntitySourceV2 = typeof EntitySourceV2.Type;

const RootEventEntityV2 = strictStruct({
	alias: Schema.String,
	schemas: Schema.NonEmptyArray(Schema.String),
}).annotations({ identifier: "RootEventEntityV2" });
export type RootEventEntityV2 = typeof RootEventEntityV2.Type;

export const NestedEventSourceV2 = strictStruct({
	alias: Schema.String,
	entityRef: Schema.String,
	type: Schema.Literal("events"),
	where: Schema.NullOr(Expr),
	schemas: Schema.NonEmptyArray(Schema.String),
}).annotations({ identifier: "NestedEventSourceV2" });
export type NestedEventSourceV2 = typeof NestedEventSourceV2.Type;

export const RootEventSourceV2 = strictStruct({
	alias: Schema.String,
	entity: RootEventEntityV2,
	type: Schema.Literal("events"),
	where: Schema.NullOr(Expr),
	schemas: Schema.NonEmptyArray(Schema.String),
}).annotations({ identifier: "RootEventSourceV2" });
export type RootEventSourceV2 = typeof RootEventSourceV2.Type;

export const EventSourceV2 = Schema.Union(NestedEventSourceV2, RootEventSourceV2).annotations({
	identifier: "EventSourceV2",
});
export type EventSourceV2 = typeof EventSourceV2.Type;

const RelationshipEndpointV2 = strictStruct({
	alias: Schema.String,
	schemas: Schema.NonEmptyArray(Schema.String),
}).annotations({ identifier: "RelationshipEndpointV2" });
export type RelationshipEndpointV2 = typeof RelationshipEndpointV2.Type;

export const RelationshipSourceV2 = strictStruct({
	alias: Schema.String,
	where: Schema.NullOr(Expr),
	sourceEntity: RelationshipEndpointV2,
	targetEntity: RelationshipEndpointV2,
	type: Schema.Literal("relationships"),
	schemas: Schema.NonEmptyArray(Schema.String),
}).annotations({ identifier: "RelationshipSourceV2" });
export type RelationshipSourceV2 = typeof RelationshipSourceV2.Type;

export const SourceV2 = Schema.Union(EntitySourceV2, NestedEventSourceV2).annotations({
	identifier: "SourceV2",
});
export type SourceV2 = typeof SourceV2.Type;

export const RootSourceV2 = Schema.Union(
	EntitySourceV2,
	RootEventSourceV2,
	RelationshipSourceV2,
).annotations({ identifier: "RootSourceV2" });
export type RootSourceV2 = typeof RootSourceV2.Type;

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

export type IncludeEntryV2 = {
	readonly key: string;
	readonly limit: number;
	readonly source: EntitySourceV2;
	readonly include?: readonly IncludeEntryV2[];
	readonly fields: readonly (typeof FieldDef.Type)[];
	readonly orderBy: readonly [typeof OrderByEntry.Type, ...Array<typeof OrderByEntry.Type>];
};

export const IncludeEntryV2: Schema.Schema<IncludeEntryV2> = Schema.suspend(() =>
	strictStruct({
		key: Schema.String,
		source: EntitySourceV2,
		fields: Schema.Array(FieldDef),
		limit: Schema.Int.pipe(Schema.positive()),
		orderBy: Schema.NonEmptyArray(OrderByEntry),
		include: Schema.optional(Schema.Array(IncludeEntryV2)),
	}),
).annotations({ identifier: "IncludeEntryV2" });

export const RowsOutputV2 = strictStruct({
	pagination: Pagination,
	type: Schema.Literal("rows"),
	fields: Schema.Array(FieldDef),
	orderBy: Schema.NonEmptyArray(OrderByEntry),
	include: Schema.optional(Schema.Array(IncludeEntryV2)),
}).annotations({ identifier: "RowsOutputV2" });
export type RowsOutputV2 = typeof RowsOutputV2.Type;

export const AggregateOutputV2 = strictStruct({
	type: Schema.Literal("aggregate"),
	measures: Schema.NonEmptyArray(AggregateMeasureDef),
	groupBy: Schema.optional(Schema.Array(FieldDef)),
	limit: Schema.optional(Schema.Int.pipe(Schema.positive())),
	orderBy: Schema.optional(Schema.NonEmptyArray(OrderByEntry)),
}).annotations({ identifier: "AggregateOutputV2" });
export type AggregateOutputV2 = typeof AggregateOutputV2.Type;

export const OutputV2 = Schema.Union(RowsOutputV2, AggregateOutputV2).annotations({
	identifier: "OutputV2",
});
export type OutputV2 = typeof OutputV2.Type;

export const QueryDocumentV2 = strictStruct({
	output: OutputV2,
	source: RootSourceV2,
	version: Schema.Literal(2),
}).annotations({ identifier: "QueryDocumentV2" });
export type QueryDocumentV2 = typeof QueryDocumentV2.Type;

export const FieldValue = strictStruct({
	value: Schema.Unknown,
	kind: Schema.Literal("boolean", "date", "image", "json", "null", "number", "text"),
}).annotations({ identifier: "FieldValue" });
export type FieldValue = typeof FieldValue.Type;

const LimitedPageInfo = strictStruct({
	limit: Schema.Int,
	hasMore: Schema.Boolean,
}).annotations({ identifier: "LimitedPageInfo" });

export type IncludedRowsValue = {
	readonly items: readonly RowItem[];
	readonly pageInfo: typeof LimitedPageInfo.Type;
};

export type RowValue = FieldValue | IncludedRowsValue;
export type RowItem = Readonly<Record<string, RowValue>>;

export const RowValue: Schema.Schema<RowValue> = Schema.suspend(() =>
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

export const RowsResponseV2 = strictStruct({
	type: Schema.Literal("rows"),
	data: strictStruct({
		pageInfo: RowsPageInfo,
		items: Schema.Array(Schema.Record({ key: Schema.String, value: RowValue })),
	}),
}).annotations({ identifier: "RowsResponseV2" });
export type RowsResponseV2 = typeof RowsResponseV2.Type;

export const AggregateResponseV2 = strictStruct({
	type: Schema.Literal("aggregate"),
	data: strictStruct({
		pageInfo: Schema.optional(LimitedPageInfo),
		items: Schema.Array(Schema.Record({ key: Schema.String, value: RowValue })),
	}),
}).annotations({ identifier: "AggregateResponseV2" });
export type AggregateResponseV2 = typeof AggregateResponseV2.Type;

export const QueryResponseV2 = Schema.Union(RowsResponseV2, AggregateResponseV2).annotations({
	identifier: "QueryResponseV2",
});
export type QueryResponseV2 = typeof QueryResponseV2.Type;
