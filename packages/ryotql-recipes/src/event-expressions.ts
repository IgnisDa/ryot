import type {
	Join,
	Predicate,
	ScalarExpression,
	TableReference,
} from "@ryot-app/contract/modules/ryotql/language";
import { and, ascending, column, descending, eq, first, gt, or } from "@ryot-app/ryotql";

type EventOrderExpressions = {
	readonly id: ScalarExpression;
	readonly createdAt: ScalarExpression;
	readonly occurredAt: ScalarExpression;
};

const eventOrderExpressions = (event: TableReference): EventOrderExpressions => ({
	id: column(event, "id"),
	createdAt: column(event, "createdAt"),
	occurredAt: column(event, "occurredAt"),
});

export const eventOrderAscending = (event: TableReference) =>
	[
		ascending(column(event, "occurredAt")),
		ascending(column(event, "createdAt")),
		ascending(column(event, "id")),
	] as const;

export const eventOrderDescending = (event: TableReference) =>
	[
		descending(column(event, "occurredAt")),
		descending(column(event, "createdAt")),
		descending(column(event, "id")),
	] as const;

export const eventIsAfter = (
	event: TableReference,
	boundary: TableReference | EventOrderExpressions,
) => {
	const current = eventOrderExpressions(event);
	const previous = "alias" in boundary ? eventOrderExpressions(boundary) : boundary;
	return or(
		gt(current.occurredAt, previous.occurredAt),
		and(eq(current.occurredAt, previous.occurredAt), gt(current.createdAt, previous.createdAt)),
		and(
			eq(current.occurredAt, previous.occurredAt),
			eq(current.createdAt, previous.createdAt),
			gt(current.id, previous.id),
		),
	);
};

export const latestEventField = (
	event: TableReference,
	input: {
		readonly select: ScalarExpression;
		readonly where?: Predicate | undefined;
		readonly joins?: readonly Join[] | undefined;
	},
) => first(event, { ...input, orderBy: eventOrderDescending(event) });
