import type { EventAggregation } from "@ryot/ts-utils";
import type { ViewExpression, ViewTransformName } from "~/lib/views/expression";
import type { ViewPredicate } from "~/lib/views/filtering";

export const schemaPropertyExpression = (
	schemaSlug: string,
	field: string,
): ViewExpression => ({
	type: "reference",
	reference: { type: "entity", slug: schemaSlug, path: ["properties", field] },
});

export const eventExpression = (
	joinKey: string,
	field: string,
): ViewExpression => ({
	type: "reference",
	reference: { type: "event", joinKey, path: ["properties", field] },
});

export const entityColumnExpression = (
	schemaSlug: string,
	column: string,
): ViewExpression => ({
	type: "reference",
	reference: { type: "entity", slug: schemaSlug, path: [column] },
});

export const eventAggregateExpression = (
	eventSchemaSlug: string,
	path: string[],
	aggregation: EventAggregation,
): ViewExpression => ({
	type: "reference",
	reference: { type: "event-aggregate", eventSchemaSlug, path, aggregation },
});

export const computedExpression = (key: string): ViewExpression => ({
	type: "reference",
	reference: { key, type: "computed-field" },
});

export const literalExpression = (value: unknown): ViewExpression => ({
	value,
	type: "literal",
});

export const nullExpression = (): ViewExpression => literalExpression(null);

export const transformExpression = (
	name: ViewTransformName,
	expression: ViewExpression,
): ViewExpression => ({
	name,
	expression,
	type: "transform",
});

export const coalesceExpression = (
	...values: ViewExpression[]
): ViewExpression => ({
	values,
	type: "coalesce",
});

export const sortDefinition = (expression: ViewExpression) => ({
	expression,
	direction: "asc" as const,
});

export function comparisonPredicate(
	left: ViewExpression,
	right: ViewExpression,
): ViewPredicate;
export function comparisonPredicate(
	left: ViewExpression,
	operator: Extract<ViewPredicate, { type: "comparison" }>["operator"],
	right: ViewExpression,
): ViewPredicate;
export function comparisonPredicate(
	left: ViewExpression,
	operatorOrRight:
		| ViewExpression
		| Extract<ViewPredicate, { type: "comparison" }>["operator"],
	right?: ViewExpression,
): ViewPredicate {
	if (typeof operatorOrRight === "string") {
		return {
			left,
			type: "comparison",
			operator: operatorOrRight,
			right: right ?? literalExpression(null),
		};
	}

	return {
		left,
		operator: "eq",
		type: "comparison",
		right: operatorOrRight,
	};
}
