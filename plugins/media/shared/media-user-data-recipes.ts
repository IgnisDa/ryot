import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	column,
	defineRecipe,
	entitySchemaPredicate,
	selectedField,
	selectedOptionalRow,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import {
	EntityId,
	EntitySchemaSlug,
	PluginId,
	type PluginIdentityReference,
} from "@ryot-app/plugin-kit/schema";

import { entityId } from "./entity-selections";

export const mediaUserDataDestinationRecipe = defineRecipe(
	(input: {
		readonly entityId: string;
		readonly entitySchemaSlug: string;
		readonly reference: PluginIdentityReference;
	}) => {
		const destination = table("entity", "destination");
		return {
			map: ({ destination: row }) => Result.succeed(row ?? null),
			queries: {
				destination: selectedOptionalRow(destination, {
					orderBy: [ascending(column(destination, "id"))],
					where: and(
						entitySchemaPredicate(destination, input.entitySchemaSlug, input.reference),
						entityId(destination, input.entityId),
					),
					selection: {
						id: selectedField(column(destination, "id"), EntityId),
						name: selectedField(column(destination, "name"), Schema.String),
						entitySchemaSlug: selectedField(
							column(destination, "entitySchemaSlug"),
							EntitySchemaSlug,
						),
						entitySchemaPluginId: selectedField(
							column(destination, "entitySchemaPluginId"),
							PluginId,
						),
					},
				}),
			},
		};
	},
);
