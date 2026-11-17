import type { QueryOwnerReference } from "@ryot-app/contract/modules/plugins/references";
import {
	EntityId,
	EntitySchemaSlug,
	PluginId,
	SandboxProviderId,
} from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import type { Recipe } from "@ryot-app/ryotql";
import {
	ascending,
	column,
	defineRecipe,
	inArray,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import { Result, Schema } from "effect";

import { IsoDateString } from "./codecs";
import { eventHistoryRecipe } from "./events";

export const entityReadRecipe = (() => {
	const recipeParameters = parameters({
		fields: {
			entityIds: {
				type: "array",
				description: "Query argument",
				validation: { required: true },
				label: kernelMessage("recipe.parameter.entities"),
				items: {
					type: "string",
					validation: { required: true },
					description: "Query argument value",
					label: kernelMessage("recipe.parameter.value"),
				},
			},
		},
	});

	const entity = table("entity", "entity");
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ entities }) => Result.succeed(entities),
		queries: {
			entities: selectedRows(entity, {
				limit: 100,
				orderBy: [ascending(column(entity, "id"))],
				where: inArray(column(entity, "id"), recipeParameters.list("entityIds")),
				selection: {
					id: selectedField(column(entity, "id"), EntityId),
					name: selectedField(column(entity, "name"), Schema.String),
					properties: selectedField(column(entity, "properties"), JsonValue),
					createdAt: selectedField(column(entity, "createdAt"), IsoDateString),
					updatedAt: selectedField(column(entity, "updatedAt"), IsoDateString),
					entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), EntitySchemaSlug),
					externalId: selectedField(column(entity, "externalId"), Schema.NullOr(Schema.String)),
					populatedAt: selectedField(column(entity, "populatedAt"), Schema.NullOr(IsoDateString)),
					providerId: selectedField(column(entity, "providerId"), Schema.NullOr(SandboxProviderId)),
					entitySchemaPluginId: selectedField(
						column(entity, "entitySchemaPluginId"),
						Schema.NullOr(PluginId),
					),
				},
			}),
		},
	});
})();

export const eventReadRecipe = (input: {
	readonly eventSchemaSlug: string;
	readonly entitySchemaSlug: string;
	readonly owner: QueryOwnerReference;
}) =>
	eventHistoryRecipe({
		owner: input.owner,
		eventSchemaSlugs: [input.eventSchemaSlug],
		entitySchemaSlugs: [input.entitySchemaSlug],
	});

export type EntityReadResult = Recipe.Success<typeof entityReadRecipe>;
export type EventReadResult = Recipe.Success<ReturnType<typeof eventReadRecipe>>;
