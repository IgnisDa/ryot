import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { strFromU8, unzipSync } from "@ryot-app/sandbox-sdk/fflate";
import { readNamedArtifact } from "@ryot-app/sandbox-sdk/filesystem";

import { MediaSandboxError } from "../lib/failures";
import { batchMediaImportResult } from "./helpers";
import { MediaImportAdapterBatch, MediaImportParserInput } from "./schemas";
import { adaptSpotifyStreamingHistory } from "./spotify";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.spotify",
	name: "Parse Spotify import",
	requiredPluginConfigKeys: [],
	capabilities: ["artifact-read"],
});

const STREAMING_HISTORY_ENTRY = /(^|\/)Streaming_History_(Audio|Video)_[^/]*\.json$/;

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const parseHistoryEntry = (archive: Uint8Array, name: string) =>
	decodeJson(
		strFromU8(
			unzipSync(archive, { filter: (file) => file.name === name })[name] ?? new Uint8Array(),
		),
	).pipe(
		Effect.map((rows) => ({ name, rows })),
		Effect.mapError(() => new MediaSandboxError({ message: `${name} is not valid JSON` })),
	);

export default defineScript({
	manifest,
	input: MediaImportParserInput,
	output: MediaImportAdapterBatch,
	run: (input) =>
		Effect.gen(function* () {
			const archive = yield* readNamedArtifact("uploadToken");
			const entryNames: string[] = [];
			unzipSync(archive, {
				filter: (file) => {
					entryNames.push(file.name);
					return false;
				},
			});
			const historyNames = entryNames.filter((name) => STREAMING_HISTORY_ENTRY.test(name)).sort();
			if (historyNames.length === 0) {
				return yield* new MediaSandboxError({
					message:
						"No Spotify extended streaming history files were found in the archive. Request Extended streaming history, not Account data.",
				});
			}
			const files = [];
			for (const name of historyNames) {
				files.push(yield* parseHistoryEntry(archive, name));
			}
			return batchMediaImportResult(adaptSpotifyStreamingHistory(files), input.start, input.limit);
		}),
});
