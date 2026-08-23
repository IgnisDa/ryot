import {
	EntityId,
	type EntitySchemaSlug,
	type SandboxProviderId,
} from "@ryot-app/contract/schema/brands";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	exists,
	inArray,
	join,
	literal,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

export const providerEntityLinksRecipe = defineRecipe(
	(input: {
		readonly providerId: SandboxProviderId;
		readonly entitySchemaSlug: EntitySchemaSlug;
		readonly externalIds: readonly [string, ...string[]];
	}) => {
		const entity = table("entity", "entity");
		const library = table("entity", "library");
		const relationship = table("relationship", "inLibrary");

		return {
			queries: {
				links: selectedRows(entity, {
					limit: input.externalIds.length,
					orderBy: [ascending(column(entity, "id"))],
					selection: {
						entityId: selectedField(column(entity, "id"), EntityId),
						externalId: selectedField(column(entity, "externalId"), Schema.String),
					},
					where: and(
						eq(column(entity, "entitySchemaSlug"), literal(input.entitySchemaSlug)),
						eq(column(entity, "providerId"), literal(input.providerId)),
						inArray(
							column(entity, "externalId"),
							input.externalIds.map((externalId) => literal(externalId)),
						),
						exists(relationship, {
							joins: [
								join(
									"inner",
									library,
									eq(column(relationship, "targetEntityId"), column(library, "id")),
								),
							],
							where: and(
								eq(column(relationship, "sourceEntityId"), column(entity, "id")),
								eq(column(relationship, "relationshipSchemaSlug"), literal("in-library")),
								eq(column(library, "entitySchemaSlug"), literal("library")),
							),
						}),
					),
				}),
			},
			map: ({ links }) => Result.succeed(links.items),
		};
	},
);
