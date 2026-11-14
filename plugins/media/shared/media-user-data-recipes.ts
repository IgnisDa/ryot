import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	parameters,
	schemaOwnerPredicate,
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

export const mediaUserDataDestinationRecipe = (input: {
	readonly reference: PluginIdentityReference;
}) => {
	const inputParameters = parameters({
		fields: {
			entityId: {
				type: "string",
				label: "entityId",
				validation: { required: true },
				description: "entityId for this selection",
			},
			entitySchemaSlug: {
				type: "string",
				label: "entitySchemaSlug",
				validation: { required: true },
				description: "entitySchemaSlug for this selection",
			},
		},
	});
	const destination = table("entity", "destination");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ destination: row }) => Result.succeed(row ?? null),
		queries: {
			destination: selectedOptionalRow(destination, {
				orderBy: [ascending(column(destination, "id"))],
				where: and(
					schemaOwnerPredicate(destination, "entitySchemaPluginId", input.reference),
					eq(column(destination, "entitySchemaSlug"), inputParameters.value("entitySchemaSlug")),
					eq(column(destination, "id"), inputParameters.value("entityId")),
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
	});
};
