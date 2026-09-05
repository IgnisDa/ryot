import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { DateTime, Effect } from "@ryot-app/sandbox-sdk/effect";
import { writeScratchChunks } from "@ryot-app/sandbox-sdk/filesystem";
import { genericImportAdapterManifestSchema } from "@ryot-app/sandbox-sdk/imports";

import { createMediaImportChunk } from "./chunks";
import { admitIntegrationProgress } from "./integration-progress";
import { MediaImportWriteChunkInput } from "./schemas";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.write-chunks",
	requiredSystemConfigKeys: [],
	name: "Write media import chunks",
	requiredPluginConfigKeys: ["progressUpdateThresholdHours"],
	capabilities: [
		"scratch",
		"getPluginConfig",
		"executeRyotql",
		"claimPersistentValue",
		"getCurrentIntegration",
		"log",
	],
});

export default defineScript({
	manifest,
	input: MediaImportWriteChunkInput,
	output: genericImportAdapterManifestSchema,
	run: (input, host) =>
		Effect.gen(function* () {
			const ownershipSyncedAt = (yield* DateTime.nowAsDate).toISOString();
			const admitted = yield* admitIntegrationProgress(input, host);
			const chunk = createMediaImportChunk(admitted, ownershipSyncedAt);
			return yield* writeScratchChunks([
				{ name: "writes.json", contents: JSON.stringify(chunk) },
			]).pipe(
				Effect.map(({ chunkFiles }) => ({
					chunkFiles,
					writeItemCount: chunk.items.length,
					failureCount: chunk.failures.length,
					totalItems: chunk.failures.length + chunk.items.length,
				})),
			);
		}),
});
