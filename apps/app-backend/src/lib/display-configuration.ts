import { Schema } from "effect";

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
