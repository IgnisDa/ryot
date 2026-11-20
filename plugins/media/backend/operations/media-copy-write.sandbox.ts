import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation, OperationRejectedError } from "@ryot-app/plugin-backend-sdk/operation";
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
			const [copies, library] = yield* Effect.all([
				executeRyotqlRecipe(host.executeRyotql, mediaCopiesRecipe(reference), { copyKey: copyId }),
				executeRyotqlRecipe(host.executeRyotql, userMediaLibraryRecipe(reference), {}),
			]);
			const existing = copies.items[0];

			if (input.action === "add") {
				if (existing) {
					if (existing.entityId !== input.entityId) {
						return yield* new OperationRejectedError({
							reason: catalogMessage("ownership.id-conflict"),
						});
					}
					return { copyId };
				}
				const entities = yield* executeRyotqlRecipe(host.executeRyotql, ownershipTargetsRecipe, {
					entityIds: [input.entityId],
				});
				if (entities.length === 0) {
					return yield* new OperationRejectedError({
						reason: catalogMessage("ownership.title-not-found"),
					});
				}
			} else if (!existing) {
				if (input.action === "remove") {
					return { copyId };
				}
				return yield* new OperationRejectedError({
					reason: catalogMessage("ownership.copy-not-found"),
				});
			}

			if (existing?.properties.origin === "integration") {
				return yield* new OperationRejectedError({
					reason: catalogMessage("ownership.source-managed"),
				});
			}
			const { source, legacySources, origin = "manual" } = existing?.properties ?? {};
			const targetEntityId = input.action === "add" ? input.entityId : existing?.entityId;
			if (targetEntityId === undefined) {
				return yield* new OperationRejectedError({
					reason: catalogMessage("ownership.copy-not-found"),
				});
			}
			const identity = {
				key: copyId,
				targetEntityId,
				sourceEntityId: library.entityId,
				relationshipSchemaSlug: mediaCopyRelationship,
			};
			yield* host.changeUserRelationships([
				{
					deletes: input.action === "remove" ? [identity] : [],
					creates:
						input.action === "remove"
							? []
							: [
									...(input.action === "add"
										? [
												{
													properties: {},
													sourceEntityId: targetEntityId,
													propertiesMode: "merge" as const,
													targetEntityId: library.entityId,
													relationshipSchemaSlug: "in-media-library",
												},
											]
										: []),
									{
										...identity,
										propertiesMode: "replace",
										properties: {
											...input.details,
											origin,
											...(source === undefined ? {} : { source }),
											...(legacySources === undefined ? {} : { legacySources }),
										},
									},
								],
				},
			]);
			return { copyId };
		}),
});
