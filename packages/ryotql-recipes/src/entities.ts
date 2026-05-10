import { TranslationStatus } from "@ryot/contract/modules/entities/schemas";
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

export const entityInterestRecipe = defineRecipe(
	(input: { readonly entityIds: readonly [string, ...string[]] }) => {
		const entity = table("entity", "entity");
		return {
			queries: {
				entities: selectedRows(entity, {
					limit: input.entityIds.length,
					orderBy: [ascending(column(entity, "id"))],
					where: inArray(
						column(entity, "id"),
						input.entityIds.map((entityId) => literal(entityId)),
					),
					selection: {
						id: selectedField(column(entity, "id"), EntityId),
						properties: selectedField(column(entity, "properties"), JsonValue),
						externalId: selectedField(column(entity, "externalId"), Schema.NullOr(Schema.String)),
						populatedAt: selectedField(column(entity, "populatedAt"), Schema.NullOr(IsoDateString)),
						entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), EntitySchemaSlug),
						providerId: selectedField(
							column(entity, "providerId"),
							Schema.NullOr(SandboxProviderId),
						),
						translationStatus: selectedField(
							column(entity, "translationStatus"),
							TranslationStatus,
						),
					},
				}),
			},
			map: ({ entities }) => Result.succeed(entities.items),
		};
	},
);

export type EntityInterestResult = Recipe.Success<typeof entityInterestRecipe>;
