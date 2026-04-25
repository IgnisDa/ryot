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

export type EventAggregation = "avg" | "count" | "max" | "min" | "sum";

export type ViewTransformName = "titleCase" | "kebabCase";

export type TransformExpression = {
	type: "transform";
	name: ViewTransformName;
	expression: RuntimeReferenceExpression;
};

export type RuntimeRef =
	| { key: string; type: "computed-field" }
	| { path: string[]; type: "entity-schema" }
	| { slug: string; path: string[]; type: "entity" }
	| { joinKey: string; path: string[]; type: "event" }
	| {
			path: string[];
			eventSchemaSlug: string;
			type: "event-aggregate";
			aggregation: EventAggregation;
	  };

export type RuntimeReferenceExpression = {
	type: "reference";
	reference: RuntimeRef;
};

export const createEntityColumnExpression = (
	slug: string,
	column: string,
): RuntimeReferenceExpression => ({
	type: "reference",
	reference: { type: "entity", slug, path: [column] },
});

export const createEntityPropertyExpression = (
	slug: string,
	property: string,
): RuntimeReferenceExpression => ({
	type: "reference",
	reference: { type: "entity", slug, path: ["properties", property] },
});

export const createEventAggregateExpression = (
	eventSchemaSlug: string,
	path: string[],
	aggregation: EventAggregation,
): RuntimeReferenceExpression => ({
	type: "reference",
	reference: { type: "event-aggregate", eventSchemaSlug, path, aggregation },
});

export const createComputedFieldExpression = (
	key: string,
): RuntimeReferenceExpression => ({
	type: "reference",
	reference: { key, type: "computed-field" },
});

export const createEntitySchemaExpression = (
	column: string,
): RuntimeReferenceExpression => ({
	type: "reference",
	reference: { type: "entity-schema", path: [column] },
});

export const createTransformExpression = (
	name: ViewTransformName,
	expression: RuntimeReferenceExpression,
): TransformExpression => ({
	name,
	expression,
	type: "transform",
});
