import { Array, Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { sandboxScratchManifestSchema } from "@ryot-app/plugin-backend-sdk/filesystem";
import { genericImportChunkSchema } from "@ryot-app/plugin-backend-sdk/imports";
import { executeRyotqlRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";
import { defineActivity, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";

import { mediaImportedCopyKey } from "../../shared/media-copy";
import { mediaCopiesRecipe, mediaCopyBatchSize } from "../../shared/media-copy-recipes";
import { createMediaImportChunk } from "./chunks";
import { readMediaCapture, writeMediaCapture } from "./collection";
import { admitIntegrationProgress } from "./integration-progress";
import { MediaImportAdapterBatch, MediaImportWriteChunkActivityInput } from "./schemas";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.write-chunks",
	name: "Write media import chunks",
});

export default defineActivity({
	manifest,
	output: sandboxScratchManifestSchema,
	input: MediaImportWriteChunkActivityInput,
	run: (input, host) =>
		Effect.gen(function* () {
			const original = input.ingestionArtifacts
				? yield* Schema.decodeEffect(Schema.fromJsonString(MediaImportAdapterBatch))(
						new TextDecoder().decode(yield* readMediaCapture("batch")),
					)
				: null;
			const events = new Map(
				original?.entityGroups.flatMap((group) =>
					group.events.map((event) => [event.operationId, event] as const),
				),
			);
			const groups = new Map(original?.entityGroups.map((group) => [group.itemIndex, group]));
			const restored = {
				...input,
				failures: [...(original?.failures ?? []), ...input.failures],
				entityGroups: input.entityGroups.map((group) => ({
					...group,
					collectionMemberships:
						groups.get(group.itemIndex)?.collectionMemberships ?? group.collectionMemberships,
					entityRef: {
						...group.entityRef,
						sourceLabel:
							groups.get(group.itemIndex)?.entityRef.sourceLabel ?? group.entityRef.sourceLabel,
					},
					events: group.events.map((event) => ({
						...event,
						properties: events.get(event.operationId)?.properties ?? event.properties,
						attribution: events.get(event.operationId)?.attribution ?? event.attribution,
					})),
				})),
			};
			const admitted = yield* admitIntegrationProgress(restored, host);
			const integrationSourceKey =
				admitted.integration && admitted.entityGroups.some((group) => group.copies?.length)
					? (yield* host.getCurrentIntegration()).sourceKey
					: undefined;
			const copyKey = (copy: { source: string; sourceId: string }) =>
				mediaImportedCopyKey(integrationSourceKey, copy.source, copy.sourceId);
			const copyKeys = Array.fromIterable(
				new Set(admitted.entityGroups.flatMap((group) => (group.copies ?? []).map(copyKey))),
			);
			const existing = yield* Effect.forEach(Array.chunksOf(copyKeys, mediaCopyBatchSize), (keys) =>
				executeRyotqlRecipe(
					host.executeRyotql,
					mediaCopiesRecipe({ kind: "self" }),
					{ copyKeys: keys },
					{ pages: { copies: { limit: mediaCopyBatchSize } } },
				),
			);
			const targets = new Map(existing.flatMap(({ items }) => items.map((row) => [row.id, row])));
			const entityGroups = admitted.entityGroups.map((group) =>
				group.copies === undefined
					? group
					: {
							...group,
							copies: group.copies.map((copy) => {
								const previous = targets.get(copyKey(copy));
								return previous === undefined
									? copy
									: {
											...copy,
											subjectEntityId: previous.entityId,
											subjectEntitySchemaSlug: previous.entitySchemaSlug,
										};
							}),
						},
			);
			const chunk = createMediaImportChunk({ ...admitted, entityGroups }, integrationSourceKey);
			const contents = yield* Schema.encodeEffect(Schema.fromJsonString(genericImportChunkSchema))(
				chunk,
			);
			return yield* writeMediaCapture([{ contents, name: "writes.json" }]);
		}).pipe(Effect.map((output) => ({ output }))),
});
