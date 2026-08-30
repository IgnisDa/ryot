import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { unzipSync } from "@ryot-app/sandbox-sdk/fflate";
import { readNamedArtifact } from "@ryot-app/sandbox-sdk/filesystem";

import { mediaFailureMessage } from "../lib/error-message";
import { MediaSandboxError } from "../lib/failures";
import { batchMediaImportResult } from "./helpers";
import { MediaImportAdapterBatch, TraktImportParserInput } from "./schemas";
import { adaptTraktData, adaptTraktExport, classifyTraktExportName } from "./trakt";

const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;

export const manifest = defineManifest({
	kind: "script",
	slug: "import.trakt",
	name: "Fetch Trakt import",
	requiredSystemConfigKeys: [],
	requiredPluginConfigKeys: ["traktClientId"],
	capabilities: ["artifact-read", "httpCall", "getPluginConfig"],
});

export default defineScript({
	manifest,
	input: TraktImportParserInput,
	output: MediaImportAdapterBatch,
	run: (input, host) =>
		Effect.gen(function* () {
			if (input.mode === "export") {
				let totalBytes = 0;
				const archiveBytes = yield* readNamedArtifact("exportUploadToken");
				const archive = yield* Effect.try({
					catch: (error) =>
						error instanceof MediaSandboxError
							? error
							: new MediaSandboxError({ message: mediaFailureMessage(error) }),
					try: () =>
						unzipSync(archiveBytes, {
							filter: (file) => {
								if (!classifyTraktExportName(file.name)) {
									return false;
								}
								if (file.originalSize > MAX_ENTRY_BYTES) {
									throw new MediaSandboxError({
										message: `Trakt export entry ${file.name} exceeds decompressed size limit`,
									});
								}
								totalBytes += file.originalSize;
								if (totalBytes > MAX_TOTAL_BYTES) {
									throw new MediaSandboxError({
										message: "Trakt export exceeds total decompressed size limit",
									});
								}
								return true;
							},
						}),
				});
				const actualEntries = Object.entries(archive);
				if (actualEntries.some(([, bytes]) => bytes.byteLength > MAX_ENTRY_BYTES)) {
					return yield* new MediaSandboxError({
						message: "Trakt export entry exceeds decompressed size limit",
					});
				}
				if (
					actualEntries.reduce((total, [, bytes]) => total + bytes.byteLength, 0) > MAX_TOTAL_BYTES
				) {
					return yield* new MediaSandboxError({
						message: "Trakt export exceeds total decompressed size limit",
					});
				}
				return batchMediaImportResult(adaptTraktExport(archive), input.start, input.limit);
			}
			const { traktClientId: clientId } = yield* host.getPluginConfig(["traktClientId"]);
			if (typeof clientId !== "string" || !clientId) {
				return yield* new MediaSandboxError({
					message: "Trakt importer is not configured. Set RYOT_PLUGIN_MEDIA_TRAKT_CLIENT_ID.",
				});
			}
			const result = yield* adaptTraktData(input, clientId, host);
			return batchMediaImportResult(result, input.start, input.limit);
		}),
});
