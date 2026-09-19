import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { sandboxScratchManifestSchema } from "@ryot-app/sandbox-sdk/filesystem";
import { genericImportChunkSchema } from "@ryot-app/sandbox-sdk/imports";

import { createMediaImportChunk } from "./chunks";
import { readMediaCapture, writeMediaCapture } from "./collection";
import { admitIntegrationProgress } from "./integration-progress";
import { MediaImportAdapterBatch, MediaImportWriteChunkActivityInput } from "./schemas";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.write-chunks",
	name: "Write media import chunks",
	capabilities: [
		"scratch",
		"artifact-read",
		"getPluginConfig",
		"executeRyotql",
		"getCurrentIntegration",
		"log",
	],
});

export default defineScript({
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
			const chunk = createMediaImportChunk(admitted, input.ownershipSyncedAt);
			const contents = yield* Schema.encodeEffect(Schema.fromJsonString(genericImportChunkSchema))(
				chunk,
			);
			return yield* writeMediaCapture([{ contents, name: "writes.json" }]);
		}),
});
