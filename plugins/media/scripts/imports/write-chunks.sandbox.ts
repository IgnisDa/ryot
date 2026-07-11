import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { writeScratchChunks } from "@ryot/sandbox-sdk/filesystem";
import { genericImportAdapterManifestSchema } from "@ryot/sandbox-sdk/imports";

import { createMediaImportChunk } from "../../imports/chunks";
import { MediaImportWriteChunkInput } from "../../imports/schemas";

export const manifest = defineManifest({
	kind: "activity",
	capabilities: ["scratch"],
	name: "Write media import chunks",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "activity.import.write-chunks",
});

export default defineActivity({
	manifest,
	input: MediaImportWriteChunkInput,
	output: genericImportAdapterManifestSchema,
	run: (input) => {
		const chunk = createMediaImportChunk(input);
		return writeScratchChunks([{ name: "writes.json", contents: JSON.stringify(chunk) }]).pipe(
			Effect.map(({ chunkFiles }) => ({
				chunkFiles,
				failureCount: chunk.failures.length,
				writeItemCount: chunk.items.length,
				totalItems: chunk.failures.length + chunk.items.length,
			})),
		);
	},
});
