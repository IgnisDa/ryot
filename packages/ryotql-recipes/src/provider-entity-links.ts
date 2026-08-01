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
		readonly relationshipSlug: string;
		readonly librarySchemaSlug: string;
	}) => {
		const entity = table("entity", "entity");
		const libraryEntity = table("entity", "libraryEntity");
		const membership = table("relationship", "membership");

		return {
			map: ({ links }) => Result.succeed(links.items),
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
								eq(column(membership, "relationshipSchemaSlug"), literal(input.relationshipSlug)),
								eq(column(libraryEntity, "entitySchemaSlug"), literal(input.librarySchemaSlug)),
							),
						}),
					),
				}),
			},
		};
	},
);
