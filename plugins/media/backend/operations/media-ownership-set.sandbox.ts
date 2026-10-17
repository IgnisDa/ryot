import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import {
	and,
	ascending,
	column,
	defineRecipe,
	entitySchemaPredicate,
	executeRyotqlRecipe,
	inArray,
	literal,
	or,
	selectedField,
	selectedRows,
	table,
	userMediaLibraryRecipe,
} from "@ryot-app/plugin-backend-sdk/ryotql";

import {
	MediaOwnershipOutput,
	MediaOwnershipSetInput,
} from "../../shared/media-ownership-operations";
import { builtinMediaEntitySchemaSlugs } from "../../shared/media-schema-slugs";

const ownershipTargetsRecipe = defineRecipe((entityIds: readonly string[]) => {
	const entity = table("entity", "ownershipTarget");
	return {
		map: ({ targets }) => Result.succeed(targets.items.map(({ entityId }) => entityId)),
		queries: {
			targets: selectedRows(entity, {
				limit: entityIds.length,
				orderBy: [ascending(column(entity, "id"))],
				selection: { entityId: selectedField(column(entity, "id"), Schema.String) },
				where: and(
					inArray(
						column(entity, "id"),
						entityIds.map((entityId) => literal(entityId)),
					),
					or(
						...builtinMediaEntitySchemaSlugs.map((slug) =>
							entitySchemaPredicate(entity, slug, { kind: "self" }),
						),
					),
				),
			}),
		},
	};
});

export const manifest = defineManifest({
	kind: "operation",
	name: "Set media ownership",
	slug: "operation.media-ownership-set",
});

export default defineOperation({
	manifest,
	output: MediaOwnershipOutput,
	input: MediaOwnershipSetInput,
	run: (input, host) =>
		Effect.gen(function* () {
			const [targetIds, mediaLibrary] = yield* Effect.all([
				executeRyotqlRecipe(host.executeRyotql, ownershipTargetsRecipe(input.entityIds)),
				executeRyotqlRecipe(host.executeRyotql, userMediaLibraryRecipe({ kind: "self" })),
			]);
			const ownedOn = input.owned ? input.ownedOn : null;
			if (targetIds.length > 0) {
				yield* host.changeUserRelationships([
					{
						deletes: [],
						creates: targetIds.map((entityId) => ({
							propertiesMode: "merge",
							sourceEntityId: entityId,
							targetEntityId: mediaLibrary.entityId,
							relationshipSchemaSlug: "in-media-library",
							properties: { ownedOn, owned: input.owned },
						})),
					},
				]);
			}
			const found = new Set(targetIds);
			return {
				results: input.entityIds.map((entityId) =>
					found.has(entityId)
						? { ownedOn, entityId, owned: input.owned, status: "found" as const }
						: { entityId, status: "notFound" as const },
				),
			};
		}),
});
