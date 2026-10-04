import type { QueryOwnerReference } from "@ryot-app/contract/modules/plugins/references";
import { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import {
	EntityId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
	PluginId,
} from "@ryot-app/contract/schema/brands";
import {
	schemaOwnerPredicate,
	and,
	column,
	defineRecipe,
	eq,
	inArray,
	join,
	literal,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import type { Recipe } from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

import { IsoDateString } from "./codecs";
import { eventOrderDescending } from "./event-expressions";

export { eventIsAfter, eventOrderDescending, latestEventField } from "./event-expressions";

export const eventHistoryRecipe = defineRecipe(
	(input: {
		readonly owner: QueryOwnerReference;
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
			map: ({ events }) => Result.succeed(events),
			queries: {
				events: selectedRows(event, {
					after: input.after,
					limit: input.limit ?? 100,
					orderBy: eventOrderDescending(event),
					joins: [join("inner", entity, eq(column(event, "entityId"), column(entity, "id")))],
					where: and(
						schemaOwnerPredicate(entity, "entitySchemaPluginId", input.owner),
						schemaOwnerPredicate(event, "eventSchemaPluginId", input.owner),
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
						properties: selectedField(column(event, "properties"), JsonValue),
						createdAt: selectedField(column(event, "createdAt"), IsoDateString),
						updatedAt: selectedField(column(event, "updatedAt"), IsoDateString),
						occurredAt: selectedField(column(event, "occurredAt"), IsoDateString),
						eventSchemaSlug: selectedField(column(event, "eventSchemaSlug"), EventSchemaSlug),
						entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), EntitySchemaSlug),
						sessionEntityId: selectedField(
							column(event, "sessionEntityId"),
							Schema.NullOr(EntityId),
						),
						eventSchemaPluginId: selectedField(
							column(event, "eventSchemaPluginId"),
							Schema.NullOr(PluginId),
						),
					},
				}),
			},
		};
	},
);

export type EventHistoryResult = Recipe.Success<typeof eventHistoryRecipe>;
