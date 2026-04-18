import { JsonValue } from "@ryot/contract/modules/ryotql/language";
import { EntityId, EntitySchemaSlug, SandboxProviderId } from "@ryot/contract/schema/brands";
import type { Recipe } from "@ryot/ryotql";
import {
	ascending,
	column,
	defineRecipe,
	inArray,
	literal,
	selectedField,
	selectedRows,
	table,
} from "@ryot/ryotql";
import { Result, Schema } from "effect";

import { IsoDateString } from "./codecs";
import { eventHistoryRecipe } from "./events";

export const entityReadRecipe = defineRecipe(
	(input: { readonly entityIds: readonly [string, ...string[]] }) => {
		const entity = table("entity", "entity");
		return {
			queries: {
				entities: selectedRows(entity, {
					limit: 100,
					orderBy: [ascending(column(entity, "id"))],
					where: inArray(
						column(entity, "id"),
						input.entityIds.map((entityId) => literal(entityId)),
					),
					selection: {
						id: selectedField(column(entity, "id"), EntityId),
						name: selectedField(column(entity, "name"), Schema.String),
						createdAt: selectedField(column(entity, "createdAt"), IsoDateString),
						updatedAt: selectedField(column(entity, "updatedAt"), IsoDateString),
						properties: selectedField(column(entity, "properties"), JsonValue),
						entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), EntitySchemaSlug),
						providerId: selectedField(
							column(entity, "providerId"),
							Schema.NullOr(SandboxProviderId),
						),
						externalId: selectedField(column(entity, "externalId"), Schema.NullOr(Schema.String)),
						populatedAt: selectedField(column(entity, "populatedAt"), Schema.NullOr(IsoDateString)),
					},
				}),
			},
			map: ({ entities }) => Result.succeed(entities),
		};
	},
);

export const eventReadRecipe = (input: {
	readonly eventSchemaSlug: string;
	readonly entitySchemaSlug: string;
	readonly after?: string | undefined;
	readonly entityId?: string | undefined;
	readonly sessionEntityId?: string | undefined;
}) =>
	eventHistoryRecipe({
		after: input.after,
		entityId: input.entityId,
		sessionEntityId: input.sessionEntityId,
		eventSchemaSlugs: [input.eventSchemaSlug],
		entitySchemaSlugs: [input.entitySchemaSlug],
	});

export type EntityReadResult = Recipe.Success<typeof entityReadRecipe>;
export type EventReadResult = Recipe.Success<typeof eventReadRecipe>;
