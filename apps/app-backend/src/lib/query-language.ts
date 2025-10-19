import { DateTime, Option, Schema } from "effect";

import { strictStruct } from "./schema/utils";

export const entityBuiltinColumns: ReadonlySet<string> = new Set([
	"id",
	"name",
	"image",
	"createdAt",
	"updatedAt",
	"externalId",
	"sandboxScriptId",
]);

export const eventJoinBuiltinColumns: ReadonlySet<string> = new Set([
	"id",
	"createdAt",
	"updatedAt",
]);

export const relationshipJoinBuiltinColumns: ReadonlySet<string> = new Set([
	"id",
	"createdAt",
	"sourceEntityId",
	"targetEntityId",
]);

export const entitySchemaBuiltinColumns: ReadonlySet<string> = new Set([
	"id",
	"slug",
	"icon",
	"name",
	"userId",
	"createdAt",
	"isBuiltin",
	"updatedAt",
	"accentColor",
]);

const EventAggregation = Schema.Literal("avg", "count", "max", "min", "sum");

const ViewTransformName = Schema.Literal("titleCase", "kebabCase");

const RuntimeReference = Schema.Union(
	strictStruct({ key: Schema.String, type: Schema.Literal("computed-field") }).pipe(
		Schema.annotations({ identifier: "ComputedFieldReference", title: "Computed Field Reference" }),
	),
	strictStruct({ path: Schema.Array(Schema.String), type: Schema.Literal("event-schema") }).pipe(
		Schema.annotations({ identifier: "EventSchemaReference", title: "Event Schema Reference" }),
	),
	strictStruct({ path: Schema.Array(Schema.String), type: Schema.Literal("entity-schema") }).pipe(
		Schema.annotations({ identifier: "EntitySchemaReference", title: "Entity Schema Reference" }),
	),
	strictStruct({
		slug: Schema.String,
		type: Schema.Literal("entity"),
		path: Schema.Array(Schema.String),
	}).pipe(Schema.annotations({ identifier: "EntityReference", title: "Entity Reference" })),
	strictStruct({
		joinKey: Schema.String,
		type: Schema.Literal("event-join"),
		path: Schema.Array(Schema.String),
	}).pipe(Schema.annotations({ identifier: "EventJoinReference", title: "Event Join Reference" })),
	strictStruct({
		joinKey: Schema.String,
		path: Schema.Array(Schema.String),
		type: Schema.Literal("relationship-join"),
	}).pipe(
		Schema.annotations({
			identifier: "RelationshipJoinReference",
			title: "Relationship Join Reference",
		}),
	),
	strictStruct({
		eventSchemaSlug: Schema.String,
		type: Schema.Literal("event-aggregate"),
		path: Schema.optional(Schema.Array(Schema.String)),
		aggregation: EventAggregation,
	}).pipe(
		Schema.annotations({
			identifier: "EventAggregateReference",
			title: "Event Aggregate Reference",
		}),
	),
	strictStruct({
		type: Schema.Literal("event"),
		path: Schema.Array(Schema.String),
		eventSchemaSlug: Schema.optional(Schema.String),
	}).pipe(Schema.annotations({ identifier: "EventReference", title: "Event Reference" })),
);

export type RuntimeRef = typeof RuntimeReference.Type;

export type QueryExpression =
	| { readonly type: "literal"; readonly value: unknown }
	| { readonly type: "reference"; readonly reference: RuntimeRef }
	| { readonly type: "round"; readonly expression: QueryExpression }
	| { readonly type: "floor"; readonly expression: QueryExpression }
	| { readonly type: "integer"; readonly expression: QueryExpression }
	| { readonly type: "isNotNull"; readonly expression: QueryExpression }
	| { readonly type: "concat"; readonly values: ReadonlyArray<QueryExpression> }
	| { readonly type: "coalesce"; readonly values: ReadonlyArray<QueryExpression> }
	| {
			readonly type: "transform";
			readonly expression: QueryExpression;
			readonly name: typeof ViewTransformName.Type;
	  }
	| {
			readonly type: "arithmetic";
			readonly left: QueryExpression;
			readonly right: QueryExpression;
			readonly operator: "add" | "subtract" | "multiply" | "divide";
	  }
	| {
			readonly type: "conditional";
			readonly condition: QueryFilter;
			readonly whenTrue: QueryExpression;
			readonly whenFalse: QueryExpression;
	  };

export const QueryExpression: Schema.Schema<QueryExpression> = Schema.suspend(() =>
	Schema.Union(
		strictStruct({ type: Schema.Literal("literal"), value: Schema.Unknown }).pipe(
			Schema.annotations({ identifier: "LiteralExpression", title: "Literal Expression" }),
		),
		strictStruct({ type: Schema.Literal("round"), expression: QueryExpression }).pipe(
			Schema.annotations({ identifier: "RoundExpression", title: "Round Expression" }),
		),
		strictStruct({ type: Schema.Literal("floor"), expression: QueryExpression }).pipe(
			Schema.annotations({ identifier: "FloorExpression", title: "Floor Expression" }),
		),
		strictStruct({ type: Schema.Literal("integer"), expression: QueryExpression }).pipe(
			Schema.annotations({ identifier: "IntegerExpression", title: "Integer Expression" }),
		),
		strictStruct({ type: Schema.Literal("reference"), reference: RuntimeReference }).pipe(
			Schema.annotations({ identifier: "ReferenceExpression", title: "Reference Expression" }),
		),
		strictStruct({ type: Schema.Literal("isNotNull"), expression: QueryExpression }).pipe(
			Schema.annotations({ identifier: "IsNotNullExpression", title: "Is Not Null Expression" }),
		),
		strictStruct({ type: Schema.Literal("concat"), values: Schema.Array(QueryExpression) }).pipe(
			Schema.annotations({ identifier: "ConcatExpression", title: "Concat Expression" }),
		),
		strictStruct({ type: Schema.Literal("coalesce"), values: Schema.Array(QueryExpression) }).pipe(
			Schema.annotations({ identifier: "CoalesceExpression", title: "Coalesce Expression" }),
		),
		strictStruct({
			name: ViewTransformName,
			expression: QueryExpression,
			type: Schema.Literal("transform"),
		}).pipe(
			Schema.annotations({ identifier: "TransformExpression", title: "Transform Expression" }),
		),
		strictStruct({
			left: QueryExpression,
			right: QueryExpression,
			type: Schema.Literal("arithmetic"),
			operator: Schema.Literal("add", "subtract", "multiply", "divide"),
		}).pipe(
			Schema.annotations({ identifier: "ArithmeticExpression", title: "Arithmetic Expression" }),
		),
		strictStruct({
			condition: QueryFilter,
			whenTrue: QueryExpression,
			whenFalse: QueryExpression,
			type: Schema.Literal("conditional"),
		}).pipe(
			Schema.annotations({ identifier: "ConditionalExpression", title: "Conditional Expression" }),
		),
	),
).pipe(Schema.annotations({ identifier: "QueryExpression", title: "Query Expression" }));

export type QueryFilter =
	| { readonly type: "not"; readonly predicate: QueryFilter }
	| { readonly type: "isNull"; readonly expression: QueryExpression }
	| { readonly type: "isNotNull"; readonly expression: QueryExpression }
	| { readonly type: "or"; readonly predicates: ReadonlyArray<QueryFilter> }
	| { readonly type: "and"; readonly predicates: ReadonlyArray<QueryFilter> }
	| {
			readonly type: "contains";
			readonly value: QueryExpression;
			readonly expression: QueryExpression;
	  }
	| {
			readonly type: "in";
			readonly expression: QueryExpression;
			readonly values: ReadonlyArray<QueryExpression>;
	  }
	| {
			readonly type: "comparison";
			readonly left: QueryExpression;
			readonly right: QueryExpression;
			readonly operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
	  };

export const QueryFilter: Schema.Schema<QueryFilter> = Schema.suspend(() =>
	Schema.Union(
		strictStruct({ type: Schema.Literal("not"), predicate: QueryFilter }).pipe(
			Schema.annotations({ identifier: "NotFilter", title: "Not Filter" }),
		),
		strictStruct({ type: Schema.Literal("isNull"), expression: QueryExpression }).pipe(
			Schema.annotations({ identifier: "IsNullFilter", title: "Is Null Filter" }),
		),
		strictStruct({ type: Schema.Literal("isNotNull"), expression: QueryExpression }).pipe(
			Schema.annotations({ identifier: "IsNotNullFilter", title: "Is Not Null Filter" }),
		),
		strictStruct({ type: Schema.Literal("or"), predicates: Schema.Array(QueryFilter) }).pipe(
			Schema.annotations({ identifier: "OrFilter", title: "Or Filter" }),
		),
		strictStruct({ type: Schema.Literal("and"), predicates: Schema.Array(QueryFilter) }).pipe(
			Schema.annotations({ identifier: "AndFilter", title: "And Filter" }),
		),
		strictStruct({
			value: QueryExpression,
			expression: QueryExpression,
			type: Schema.Literal("contains"),
		}).pipe(Schema.annotations({ identifier: "ContainsFilter", title: "Contains Filter" })),
		strictStruct({
			type: Schema.Literal("in"),
			expression: QueryExpression,
			values: Schema.Array(QueryExpression),
		}).pipe(Schema.annotations({ identifier: "InFilter", title: "In Filter" })),
		strictStruct({
			left: QueryExpression,
			right: QueryExpression,
			type: Schema.Literal("comparison"),
			operator: Schema.Literal("eq", "neq", "gt", "gte", "lt", "lte"),
		}).pipe(Schema.annotations({ identifier: "ComparisonFilter", title: "Comparison Filter" })),
	),
).pipe(Schema.annotations({ identifier: "QueryFilter", title: "Query Filter" }));

export const Pagination = strictStruct({ page: Schema.Number, limit: Schema.Number });
export type Pagination = typeof Pagination.Type;

export const PaginationResult = strictStruct({
	page: Schema.Number,
	total: Schema.Number,
	limit: Schema.Number,
	totalPages: Schema.Number,
	hasNextPage: Schema.Boolean,
	hasPreviousPage: Schema.Boolean,
});
export type PaginationResult = typeof PaginationResult.Type;

export const DateRange = strictStruct({ endAt: Schema.String, startAt: Schema.String }).pipe(
	Schema.filter(
		(range) => {
			const startAt = DateTime.make(range.startAt);
			const endAt = DateTime.make(range.endAt);
			return Option.isSome(startAt) && Option.isSome(endAt)
				? DateTime.lessThan(startAt.value, endAt.value)
				: false;
		},
		{ message: () => "startAt must be before endAt" },
	),
);
export type DateRange = typeof DateRange.Type;

export const SavedViewSort = strictStruct({
	expression: QueryExpression,
	direction: Schema.Literal("asc", "desc"),
});
export type SavedViewSort = typeof SavedViewSort.Type;

export const SavedViewQueryField = strictStruct({
	key: Schema.String,
	expression: QueryExpression,
});
export type SavedViewQueryField = typeof SavedViewQueryField.Type;

export const AggregationDefinition = Schema.Union(
	strictStruct({ type: Schema.Literal("count") }).pipe(
		Schema.annotations({ identifier: "CountAggregation", title: "Count Aggregation" }),
	),
	strictStruct({ type: Schema.Literal("countWhere"), predicate: Schema.NullOr(QueryFilter) }).pipe(
		Schema.annotations({ identifier: "CountWhereAggregation", title: "Count Where Aggregation" }),
	),
	strictStruct({ type: Schema.Literal("countBy"), groupBy: QueryExpression }).pipe(
		Schema.annotations({ identifier: "CountByAggregation", title: "Count By Aggregation" }),
	),
	strictStruct({ type: Schema.Literal("sum"), expression: QueryExpression }).pipe(
		Schema.annotations({ identifier: "SumAggregation", title: "Sum Aggregation" }),
	),
	strictStruct({ type: Schema.Literal("avg"), expression: QueryExpression }).pipe(
		Schema.annotations({ identifier: "AvgAggregation", title: "Avg Aggregation" }),
	),
	strictStruct({ type: Schema.Literal("min"), expression: QueryExpression }).pipe(
		Schema.annotations({ identifier: "MinAggregation", title: "Min Aggregation" }),
	),
	strictStruct({ type: Schema.Literal("max"), expression: QueryExpression }).pipe(
		Schema.annotations({ identifier: "MaxAggregation", title: "Max Aggregation" }),
	),
);
export type AggregationDefinition = typeof AggregationDefinition.Type;

export const SavedViewAggregation = strictStruct({
	key: Schema.String,
	aggregation: AggregationDefinition,
});
export type SavedViewAggregation = typeof SavedViewAggregation.Type;

export const QueryEventJoin = strictStruct({
	key: Schema.String,
	eventSchemaSlug: Schema.String,
	kind: Schema.Literal("latestEvent"),
});
export type QueryEventJoin = typeof QueryEventJoin.Type;

export const QueryRelationshipJoin = strictStruct({
	key: Schema.String,
	required: Schema.Boolean,
	relationshipSchemaSlug: Schema.String,
	kind: Schema.Literal("latestRelationship"),
	direction: Schema.Literal("incoming", "outgoing"),
	sourceEntityId: Schema.optional(Schema.String),
	targetEntityId: Schema.optional(Schema.String),
	filter: Schema.optional(Schema.NullOr(QueryFilter)),
});
export type QueryRelationshipJoin = typeof QueryRelationshipJoin.Type;

export const QueryComputedField = strictStruct({
	key: Schema.String,
	expression: QueryExpression,
});
export type QueryComputedField = typeof QueryComputedField.Type;

export const RuntimeField = strictStruct({
	key: Schema.String,
	expression: QueryExpression,
});
export type RuntimeField = typeof RuntimeField.Type;

export const SavedViewQueryDefinition = strictStruct({
	filter: Schema.NullOr(QueryFilter),
	scope: Schema.Array(Schema.String),
	sort: Schema.optional(SavedViewSort),
	pagination: Schema.optional(Pagination),
	eventJoins: Schema.Array(QueryEventJoin),
	computedFields: Schema.Array(QueryComputedField),
	mode: Schema.optional(Schema.Literal("aggregate", "entities")),
	fields: Schema.optional(Schema.Array(SavedViewQueryField)),
	aggregations: Schema.optional(Schema.Array(SavedViewAggregation)),
	relationshipJoins: Schema.optional(Schema.Array(QueryRelationshipJoin)),
});
export type SavedViewQueryDefinition = typeof SavedViewQueryDefinition.Type;

const CardDisplayConfiguration = strictStruct({
	titleProperty: QueryExpression,
	imageProperty: Schema.NullOr(QueryExpression),
	eyebrowProperty: Schema.NullOr(QueryExpression),
	calloutProperty: Schema.NullOr(QueryExpression),
	primarySubtitleProperty: Schema.NullOr(QueryExpression),
	secondarySubtitleProperty: Schema.NullOr(QueryExpression),
});

const DisplayColumn = strictStruct({
	label: Schema.String,
	expression: QueryExpression,
});

export const DisplayConfiguration = strictStruct({
	grid: CardDisplayConfiguration,
	list: CardDisplayConfiguration,
	entityIdProperty: QueryExpression,
	table: strictStruct({ columns: Schema.Array(DisplayColumn) }),
});
export type DisplayConfiguration = typeof DisplayConfiguration.Type;

export const EntitiesQueryRequest = strictStruct({
	pagination: Pagination,
	mode: Schema.Literal("entities"),
	scope: Schema.Array(Schema.String),
	fields: Schema.Array(RuntimeField),
	sort: Schema.optional(SavedViewSort),
	filter: Schema.optional(Schema.NullOr(QueryFilter)),
	eventJoins: Schema.optional(Schema.Array(QueryEventJoin)),
	computedFields: Schema.optional(Schema.Array(QueryComputedField)),
	relationshipJoins: Schema.optional(Schema.Array(QueryRelationshipJoin)),
});
export type EntitiesQueryRequest = typeof EntitiesQueryRequest.Type;

export const EventsQueryRequest = strictStruct({
	pagination: Pagination,
	mode: Schema.Literal("events"),
	fields: Schema.Array(RuntimeField),
	scope: Schema.Array(Schema.String),
	sort: Schema.optional(SavedViewSort),
	eventSchemas: Schema.Array(Schema.String),
	filter: Schema.optional(Schema.NullOr(QueryFilter)),
	eventJoins: Schema.optional(Schema.Array(QueryEventJoin)),
	computedFields: Schema.optional(Schema.Array(QueryComputedField)),
});
export type EventsQueryRequest = typeof EventsQueryRequest.Type;

export const AggregateQueryRequest = strictStruct({
	mode: Schema.Literal("aggregate"),
	scope: Schema.Array(Schema.String),
	aggregations: Schema.Array(SavedViewAggregation),
	filter: Schema.optional(Schema.NullOr(QueryFilter)),
	eventJoins: Schema.optional(Schema.Array(QueryEventJoin)),
	computedFields: Schema.optional(Schema.Array(QueryComputedField)),
	relationshipJoins: Schema.optional(Schema.Array(QueryRelationshipJoin)),
});
export type AggregateQueryRequest = typeof AggregateQueryRequest.Type;

export const TimeSeriesMetric = Schema.Union(
	strictStruct({ type: Schema.Literal("count") }).pipe(
		Schema.annotations({ identifier: "CountTimeSeriesMetric", title: "Count Time Series Metric" }),
	),
	strictStruct({ type: Schema.Literal("sum"), expression: QueryExpression }).pipe(
		Schema.annotations({ identifier: "SumTimeSeriesMetric", title: "Sum Time Series Metric" }),
	),
);
export type TimeSeriesMetric = typeof TimeSeriesMetric.Type;

export const TimeSeriesQueryRequest = strictStruct({
	dateRange: DateRange,
	metric: TimeSeriesMetric,
	mode: Schema.Literal("timeSeries"),
	scope: Schema.Array(Schema.String),
	eventSchemas: Schema.Array(Schema.String),
	bucket: Schema.Literal("day", "hour", "month", "week"),
	filter: Schema.optional(Schema.NullOr(QueryFilter)),
	computedFields: Schema.optional(Schema.Array(QueryComputedField)),
});
export type TimeSeriesQueryRequest = typeof TimeSeriesQueryRequest.Type;

export const QueryEngineRequest = Schema.Union(
	EventsQueryRequest,
	EntitiesQueryRequest,
	AggregateQueryRequest,
	TimeSeriesQueryRequest,
);
export type QueryEngineRequest = typeof QueryEngineRequest.Type;

export function getQueryEngineField(
	item: Readonly<Record<string, { kind: string; value: unknown }>> | undefined,
	key: string,
) {
	if (!item) {
		return undefined;
	}
	const field = item[key];
	return field !== undefined ? { ...field, key } : undefined;
}

export const createLiteralExpression = (value: unknown) =>
	({
		value,
		type: "literal",
	}) as const;

export const createEntityColumnExpression = (slug: string, column: string) =>
	({
		type: "reference",
		reference: { type: "entity", slug, path: [column] },
	}) as const;

export const createEntityPropertyExpression = (slug: string, property: string) =>
	({
		type: "reference",
		reference: { type: "entity", slug, path: ["properties", property] },
	}) as const;

export const createEntitySchemaExpression = (column: string) =>
	({
		type: "reference",
		reference: { type: "entity-schema", path: [column] },
	}) as const;

export const createEventAggregateExpression = (
	eventSchemaSlug: string,
	aggregation: typeof EventAggregation.Type,
	path?: ReadonlyArray<string>,
) =>
	({
		type: "reference",
		reference: { type: "event-aggregate", aggregation, eventSchemaSlug, ...(path ? { path } : {}) },
	}) as const;

export const createTransformExpression = (
	name: typeof ViewTransformName.Type,
	expression: QueryExpression,
) => ({ type: "transform", name, expression }) as const;

export const createComputedFieldExpression = (key: string) =>
	({ type: "reference", reference: { key, type: "computed-field" } }) as const;

export const createConcatExpression = (values: ReadonlyArray<QueryExpression>) =>
	({ values, type: "concat" }) as const;

export const createIsNotNullExpression = (expression: QueryExpression) => ({
	expression,
	type: "isNotNull" as const,
});

export const createConditionalExpression = (input: {
	condition: QueryFilter;
	whenTrue: QueryExpression;
	whenFalse: QueryExpression;
}) => ({ type: "conditional", ...input }) as const;
