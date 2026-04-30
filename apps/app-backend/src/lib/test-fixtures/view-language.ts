import type { ViewExpression, ViewTransformName } from "~/lib/views/expression";
import type { ViewPredicate } from "~/lib/views/filtering";

export const eventExpression = (
	joinKey: string,
	field: string,
): ViewExpression => ({
	type: "reference",
	reference: { type: "event-join", joinKey, path: ["properties", field] },
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
