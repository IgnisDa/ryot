import type { QueryOwnerReference } from "@ryot-app/contract/modules/plugins/references";
import {
	EntityId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
	PluginId,
} from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import {
	and,
	column,
	defineRecipe,
	eq,
	inArray,
	join,
	literal,
	schemaOwnerPredicate,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import type { Recipe } from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import { Result, Schema } from "effect";

import { IsoDateString } from "./codecs";
import { eventOrderDescending } from "./event-expressions";

export { eventIsAfter, latestEventField, eventOrderDescending } from "./event-expressions";

export const eventHistoryRecipe = (input: {
	readonly owner: QueryOwnerReference;
	readonly eventSchemaSlugs: readonly [string, ...string[]];
	readonly entitySchemaSlugs: readonly [string, ...string[]];
}) => {
	const recipeParameters = parameters({
		fields: {
			entityId: { type: "string", label: "entityId", description: "Query argument" },
			sessionEntityId: { type: "string", label: "sessionEntityId", description: "Query argument" },
		},
	});

	const event = table("event", "event");
	const entity = table("entity", "entity");
	const eventSchema = column(event, "eventSchemaSlug");
	const entitySchema = column(entity, "entitySchemaSlug");
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ events }) => Result.succeed(events),
		queries: {
			events: selectedRows(event, {
				limit: 20,
				maxLimit: 1000,
				orderBy: eventOrderDescending(event),
				joins: [join("inner", entity, eq(column(event, "entityId"), column(entity, "id")))],
				selection: {
					id: selectedField(column(event, "id"), EventId),
					entityId: selectedField(column(event, "entityId"), EntityId),
					properties: selectedField(column(event, "properties"), JsonValue),
					createdAt: selectedField(column(event, "createdAt"), IsoDateString),
					updatedAt: selectedField(column(event, "updatedAt"), IsoDateString),
					occurredAt: selectedField(column(event, "occurredAt"), IsoDateString),
					eventSchemaSlug: selectedField(column(event, "eventSchemaSlug"), EventSchemaSlug),
					entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), EntitySchemaSlug),
					sessionEntityId: selectedField(column(event, "sessionEntityId"), Schema.NullOr(EntityId)),
					eventSchemaPluginId: selectedField(
						column(event, "eventSchemaPluginId"),
						Schema.NullOr(PluginId),
					),
				},
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
					recipeParameters.whenSet(
						"entityId",
						eq(column(event, "entityId"), recipeParameters.value("entityId")),
					),
					recipeParameters.whenSet(
						"sessionEntityId",
						eq(column(event, "sessionEntityId"), recipeParameters.value("sessionEntityId")),
					),
				),
			}),
		},
	});
};

export type EventHistoryResult = Recipe.Success<ReturnType<typeof eventHistoryRecipe>>;
