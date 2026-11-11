import type { PluginIdentityReference } from "@ryot-app/contract/modules/plugins/references";
import { EntityId, type EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	and,
	ascending,
	column,
	defineRecipe,
	entitySchemaPredicate,
	eq,
	exists,
	inArray,
	join,
	relationshipSchemaPredicate,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import { Result, Schema } from "effect";

export const providerEntityLinksRecipe = (input: {
	readonly relationshipSlug: string;
	readonly librarySchemaSlug: string;
	readonly reference: PluginIdentityReference;
	readonly entitySchemaSlug: EntitySchemaSlug;
}) => {
	const recipeParameters = parameters({
		fields: {
			providerId: {
				type: "string",
				label: "providerId",
				description: "Query argument",
				validation: { required: true },
			},
			externalIds: {
				type: "array",
				label: "externalIds",
				description: "Query argument",
				validation: { required: true },
				items: {
					type: "string",
					label: "Value",
					validation: { required: true },
					description: "Query argument value",
				},
			},
		},
	});

	const entity = table("entity", "entity");
	const libraryEntity = table("entity", "libraryEntity");
	const membership = table("relationship", "membership");

	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ links }) => Result.succeed(links),
		queries: {
			links: selectedRows(entity, {
				limit: 100,
				maxLimit: 100,
				orderBy: [ascending(column(entity, "id"))],
				selection: {
					entityId: selectedField(column(entity, "id"), EntityId),
					externalId: selectedField(column(entity, "externalId"), Schema.String),
				},
				where: and(
					entitySchemaPredicate(entity, input.entitySchemaSlug, input.reference),
					eq(column(entity, "providerId"), recipeParameters.value("providerId")),
					inArray(column(entity, "externalId"), recipeParameters.list("externalIds")),
					exists(membership, {
						joins: [
							join(
								"inner",
								libraryEntity,
								eq(column(membership, "targetEntityId"), column(libraryEntity, "id")),
							),
						],
						where: and(
							eq(column(membership, "sourceEntityId"), column(entity, "id")),
							relationshipSchemaPredicate(membership, input.relationshipSlug, input.reference),
							entitySchemaPredicate(libraryEntity, input.librarySchemaSlug, input.reference),
						),
					}),
				),
			}),
		},
	});
};
