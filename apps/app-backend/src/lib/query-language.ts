import { Schema } from "effect";

import { strictStruct } from "./schema-utils";

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
	strictStruct({ key: Schema.String, type: Schema.Literal("computed-field") }),
	strictStruct({ path: Schema.Array(Schema.String), type: Schema.Literal("event-schema") }),
	strictStruct({ path: Schema.Array(Schema.String), type: Schema.Literal("entity-schema") }),
	strictStruct({
		slug: Schema.String,
		type: Schema.Literal("entity"),
		path: Schema.Array(Schema.String),
	}),
	strictStruct({
		joinKey: Schema.String,
		type: Schema.Literal("event-join"),
		path: Schema.Array(Schema.String),
	}),
	strictStruct({
		joinKey: Schema.String,
		path: Schema.Array(Schema.String),
		type: Schema.Literal("relationship-join"),
	}),
	strictStruct({
		eventSchemaSlug: Schema.String,
		type: Schema.Literal("event-aggregate"),
		path: Schema.optional(Schema.Array(Schema.String)),
		aggregation: EventAggregation,
	}),
	strictStruct({
		type: Schema.Literal("event"),
		path: Schema.Array(Schema.String),
		eventSchemaSlug: Schema.optional(Schema.String),
	}),
);

export type QueryExpression =
	| { readonly type: "literal"; readonly value: unknown }
	| { readonly type: "reference"; readonly reference: typeof RuntimeReference.Type }
	| {
			readonly type: "transform";
			readonly name: typeof ViewTransformName.Type;
			readonly expression: QueryExpression;
	  }
	| { readonly type: "concat"; readonly values: ReadonlyArray<QueryExpression> }
	| { readonly type: "isNotNull"; readonly expression: QueryExpression }
	| {
			readonly type: "conditional";
			readonly condition: QueryExpression;
			readonly whenTrue: QueryExpression;
			readonly whenFalse: QueryExpression;
	  };

export const QueryExpression: Schema.Schema<QueryExpression> = Schema.suspend(() =>
	Schema.Union(
		strictStruct({ type: Schema.Literal("literal"), value: Schema.Unknown }),
		strictStruct({ type: Schema.Literal("reference"), reference: RuntimeReference }),
		strictStruct({
			type: Schema.Literal("transform"),
			name: ViewTransformName,
			expression: QueryExpression,
		}),
		strictStruct({ type: Schema.Literal("concat"), values: Schema.Array(QueryExpression) }),
		strictStruct({ type: Schema.Literal("isNotNull"), expression: QueryExpression }),
		strictStruct({
			type: Schema.Literal("conditional"),
			condition: QueryExpression,
			whenTrue: QueryExpression,
			whenFalse: QueryExpression,
		}),
	),
).pipe(Schema.annotations({ identifier: "QueryExpression", title: "Query Expression" }));

export const Pagination = strictStruct({ page: Schema.Number, limit: Schema.Number });

export const DateRange = strictStruct({ endAt: Schema.String, startAt: Schema.String });

export const SavedViewSort = strictStruct({
	expression: QueryExpression,
	direction: Schema.Literal("asc", "desc"),
});

export const SavedViewQueryField = strictStruct({
	key: Schema.String,
	expression: QueryExpression,
});

export const SavedViewAggregation = strictStruct({
	key: Schema.String,
	aggregation: strictStruct({ type: Schema.String, expression: Schema.optional(QueryExpression) }),
});

export const SavedViewQueryDefinition = strictStruct({
	scope: Schema.Array(Schema.String),
	sort: Schema.optional(SavedViewSort),
	filter: Schema.NullOr(Schema.Unknown),
	pagination: Schema.optional(Pagination),
	eventJoins: Schema.Array(Schema.Unknown),
	computedFields: Schema.Array(Schema.Unknown),
	mode: Schema.optional(Schema.Literal("aggregate", "entities")),
	fields: Schema.optional(Schema.Array(SavedViewQueryField)),
	relationshipJoins: Schema.optional(Schema.Array(Schema.Unknown)),
	aggregations: Schema.optional(Schema.Array(SavedViewAggregation)),
});

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

export const EntitiesQueryRequest = strictStruct({
	fields: Schema.Unknown,
	pagination: Pagination,
	mode: Schema.Literal("entities"),
	scope: Schema.Array(Schema.String),
	sort: Schema.optional(Schema.Unknown),
	filter: Schema.optional(Schema.Unknown),
	eventJoins: Schema.optional(Schema.Unknown),
	computedFields: Schema.optional(Schema.Unknown),
	relationshipJoins: Schema.optional(Schema.Unknown),
});

export const EventsQueryRequest = strictStruct({
	fields: Schema.Unknown,
	pagination: Pagination,
	eventSchemas: Schema.Unknown,
	mode: Schema.Literal("events"),
	scope: Schema.Array(Schema.String),
	sort: Schema.optional(Schema.Unknown),
	filter: Schema.optional(Schema.Unknown),
	eventJoins: Schema.optional(Schema.Unknown),
	computedFields: Schema.optional(Schema.Unknown),
});

export const AggregateQueryRequest = strictStruct({
	aggregations: Schema.Unknown,
	mode: Schema.Literal("aggregate"),
	scope: Schema.Array(Schema.String),
	filter: Schema.optional(Schema.Unknown),
	eventJoins: Schema.optional(Schema.Unknown),
	computedFields: Schema.optional(Schema.Unknown),
	relationshipJoins: Schema.optional(Schema.Unknown),
});

export const TimeSeriesQueryRequest = strictStruct({
	dateRange: DateRange,
	metric: Schema.Unknown,
	eventSchemas: Schema.Unknown,
	mode: Schema.Literal("timeSeries"),
	scope: Schema.Array(Schema.String),
	filter: Schema.optional(Schema.Unknown),
	computedFields: Schema.optional(Schema.Unknown),
	bucket: Schema.Literal("day", "hour", "month", "week"),
});

export const QueryEngineRequest = Schema.Union(
	EventsQueryRequest,
	EntitiesQueryRequest,
	AggregateQueryRequest,
	TimeSeriesQueryRequest,
);

export const createLiteralExpression = (value: unknown): QueryExpression => ({
	value,
	type: "literal",
});

export const createEntityColumnExpression = (slug: string, column: string): QueryExpression => ({
	type: "reference",
	reference: { type: "entity", slug, path: [column] },
});

export const createEntityPropertyExpression = (
	slug: string,
	property: string,
): QueryExpression => ({
	type: "reference",
	reference: { type: "entity", slug, path: ["properties", property] },
});

export const createEntitySchemaExpression = (column: string): QueryExpression => ({
	type: "reference",
	reference: { type: "entity-schema", path: [column] },
});

export const createEventAggregateExpression = (
	eventSchemaSlug: string,
	aggregation: typeof EventAggregation.Type,
	path?: ReadonlyArray<string>,
): QueryExpression => ({
	type: "reference",
	reference: { type: "event-aggregate", aggregation, eventSchemaSlug, ...(path ? { path } : {}) },
});

export const createTransformExpression = (
	name: typeof ViewTransformName.Type,
	expression: QueryExpression,
): QueryExpression => ({ type: "transform", name, expression });

export const createConcatExpression = (
	values: ReadonlyArray<QueryExpression>,
): QueryExpression => ({ values, type: "concat" });

export const createIsNotNullExpression = (expression: QueryExpression): QueryExpression => ({
	expression,
	type: "isNotNull",
});

export const createConditionalExpression = (input: {
	whenTrue: QueryExpression;
	condition: QueryExpression;
	whenFalse: QueryExpression;
}): QueryExpression => ({ type: "conditional", ...input });
