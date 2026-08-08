import {
	JsonValue,
	type Join,
	type Predicate,
	type ScalarExpression,
	type TableReference,
} from "@ryot/contract/modules/ryotql/language";
import { EntityId, EntitySchemaSlug, EventId, EventSchemaSlug } from "@ryot/contract/schema/brands";
import type { Recipe } from "@ryot/ryotql";
import {
	and,
	column,
	defineRecipe,
	descending,
	eq,
	first,
	gt,
	inArray,
	join,
	literal,
	or,
	selectedField,
	selectedRows,
	table,
} from "@ryot/ryotql";
import { Result, Schema } from "effect";

import { IsoDateString } from "./codecs";

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
		readonly where?: Predicate | undefined;
		readonly joins?: readonly Join[] | undefined;
		readonly select: ScalarExpression;
	},
) => first(event, { ...input, orderBy: eventOrderDescending(event) });

export const eventHistoryRecipe = defineRecipe(
	(input: {
		readonly after?: string | undefined;
		readonly limit?: number | undefined;
		readonly entityId?: string | undefined;
		readonly sessionEntityId?: string | undefined;
		readonly eventSchemaSlugs: readonly [string, ...string[]];
		readonly entitySchemaSlugs: readonly [string, ...string[]];
	}) => {
		const event = table("event", "event");
		const entity = table("entity", "entity");
		const eventSchema = column(event, "eventSchemaSlug");
		const entitySchema = column(entity, "entitySchemaSlug");
		return {
			queries: {
				events: selectedRows(event, {
					after: input.after,
					limit: input.limit ?? 100,
					orderBy: eventOrderDescending(event),
					joins: [join("inner", entity, eq(column(event, "entityId"), column(entity, "id")))],
					where: and(
						input.eventSchemaSlugs.length === 1
							? eq(eventSchema, literal(input.eventSchemaSlugs[0]))
							: inArray(
									eventSchema,
									input.eventSchemaSlugs.map((slug) => literal(slug)),
								),
						input.entitySchemaSlugs.length === 1
							? eq(entitySchema, literal(input.entitySchemaSlugs[0]))
							: inArray(
									entitySchema,
									input.entitySchemaSlugs.map((slug) => literal(slug)),
								),
						...(input.entityId ? [eq(column(event, "entityId"), literal(input.entityId))] : []),
						...(input.sessionEntityId
							? [eq(column(event, "sessionEntityId"), literal(input.sessionEntityId))]
							: []),
					),
					selection: {
						id: selectedField(column(event, "id"), EventId),
						entityId: selectedField(column(event, "entityId"), EntityId),
						createdAt: selectedField(column(event, "createdAt"), IsoDateString),
						updatedAt: selectedField(column(event, "updatedAt"), IsoDateString),
						occurredAt: selectedField(column(event, "occurredAt"), IsoDateString),
						properties: selectedField(column(event, "properties"), JsonValue),
						eventSchemaSlug: selectedField(column(event, "eventSchemaSlug"), EventSchemaSlug),
						sessionEntityId: selectedField(
							column(event, "sessionEntityId"),
							Schema.NullOr(EntityId),
						),
						entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), EntitySchemaSlug),
					},
				}),
			},
			map: ({ events }) => Result.succeed(events),
		};
	},
);

export type EventHistoryResult = Recipe.Success<typeof eventHistoryRecipe>;
