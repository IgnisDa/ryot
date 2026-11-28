import { existingEntity, expectedRelationshipProperties } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation, reject } from "@ryot-app/plugin-backend-sdk/operation";
import {
	and,
	ascending,
	column,
	defineRecipe,
	entitySchemaPredicate,
	executeRyotqlRecipe,
	inArray,
	or,
	parameters,
	selectedField,
	selectedRows,
	table,
	userMediaLibraryRecipe,
} from "@ryot-app/plugin-backend-sdk/ryotql";
import { EntityId } from "@ryot-app/plugin-kit/schema";

import { mediaCopyRelationship } from "../../shared/media-copy";
import { mediaCopiesRecipe } from "../../shared/media-copy-recipes";
import { MediaCopyWriteInput, MediaCopyWriteOutput } from "../../shared/media-ownership-operations";
import { mediaOwnableEntitySchemaSlugs } from "../../shared/media-schema-slugs";
import { catalogMessage } from "../../shared/messages.generated";

const ownershipTargetsRecipe = (() => {
	const inputParameters = parameters({
		fields: {
			entityIds: {
				type: "array",
				validation: { required: true },
				description: "entityIds to read",
				label: catalogMessage("query-parameter.entities"),
				items: {
					type: "string",
					description: "Selected ID",
					label: catalogMessage("query-parameter.id"),
				},
			},
		},
	});
	const entity = table("entity", "ownershipTarget");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ targets }) => Result.succeed(targets.items.map(({ entityId }) => entityId)),
		queries: {
			targets: selectedRows(entity, {
				limit: 100,
				orderBy: [ascending(column(entity, "id"))],
				selection: { entityId: selectedField(column(entity, "id"), Schema.String) },
				where: and(
					inArray(column(entity, "id"), inputParameters.list("entityIds")),
					or(
						...mediaOwnableEntitySchemaSlugs.map((slug) =>
							entitySchemaPredicate(entity, slug, { kind: "self" }),
						),
					),
				),
			}),
		},
	});
})();
const reference = { kind: "self" } as const;

export const manifest = defineManifest({
	kind: "operation",
	name: "Manage owned copies",
	slug: "operation.media-copy-write",
});

export default defineOperation({
	manifest,
	input: MediaCopyWriteInput,
	output: MediaCopyWriteOutput,
	run: (input, host) =>
		Effect.gen(function* () {
			const copyId = input.action === "add" ? `manual:${input.copyId}` : input.copyId;
			const [copies, libraryEntity] = yield* Effect.all([
				executeRyotqlRecipe(host.executeRyotql, mediaCopiesRecipe(reference), { copyKey: copyId }),
				executeRyotqlRecipe(host.executeRyotql, userMediaLibraryRecipe(reference), {}),
			]);
			const existing = copies.items[0];

			if (input.action === "add") {
				if (existing) {
					if (existing.entityId !== input.entityId) {
						return yield* reject(catalogMessage("ownership.id-conflict"));
					}
					return { output: { copyId } };
				}
				const entities = yield* executeRyotqlRecipe(host.executeRyotql, ownershipTargetsRecipe, {
					entityIds: [input.entityId],
				});
				if (entities.length === 0) {
					return yield* reject(catalogMessage("ownership.title-not-found"));
				}
			} else if (!existing) {
				if (input.action === "remove") {
					return { output: { copyId } };
				}
				return yield* reject(catalogMessage("ownership.copy-not-found"));
			}

			if (existing?.properties.origin === "integration") {
				return yield* reject(catalogMessage("ownership.source-managed"));
			}
			const { source, legacySources, origin = "manual" } = existing?.properties ?? {};
			const targetEntityId = input.action === "add" ? input.entityId : existing?.entityId;
			if (targetEntityId === undefined) {
				return yield* reject(catalogMessage("ownership.copy-not-found"));
			}
			const library = existingEntity(EntityId.make(libraryEntity.entityId));
			const identity = {
				key: copyId,
				source: library,
				relationshipSchemaSlug: mediaCopyRelationship,
				target: existingEntity(EntityId.make(targetEntityId)),
			};
			if (input.action === "remove") {
				return { output: { copyId }, changes: { relationships: { deletes: [identity] } } };
			}
			return {
				output: { copyId },
				changes: {
					relationships: {
						upserts: [
							...(input.action === "add"
								? [
										{
											properties: {},
											target: library,
											source: identity.target,
											propertiesMode: "merge" as const,
											relationshipSchemaSlug: "in-media-library",
										},
									]
								: []),
							{
								...identity,
								propertiesMode: "replace" as const,
								...(existing === undefined
									? {}
									: { expected: expectedRelationshipProperties(existing.properties, ["origin"]) }),
								properties: {
									...input.details,
									origin,
									...(source === undefined ? {} : { source }),
									...(legacySources === undefined ? {} : { legacySources }),
								},
							},
						],
					},
				},
			};
		}),
});
