import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { DateTime, Effect } from "@ryot/sandbox-sdk/effect";
import { writeScratchChunks } from "@ryot/sandbox-sdk/filesystem";
import { genericImportAdapterManifestSchema } from "@ryot/sandbox-sdk/imports";

import { createMediaImportChunk } from "../../imports/chunks";
import { MediaImportWriteChunkInput } from "../../imports/schemas";

export const manifest = defineManifest({
	kind: "script",
	capabilities: ["scratch"],
	slug: "import.write-chunks",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Write media import chunks",
});

export default defineScript({
	manifest,
	input: MediaImportWriteChunkInput,
	output: genericImportAdapterManifestSchema,
	run: (input) =>
		Effect.gen(function* () {
			const ownershipSyncedAt = (yield* DateTime.nowAsDate).toISOString();
			const chunk = createMediaImportChunk(input, ownershipSyncedAt);
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
