import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { listZipEntries } from "@ryot-app/sandbox-sdk/fflate";
import { readArtifactRange } from "@ryot-app/sandbox-sdk/filesystem";
import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";

import { MediaControlInput, MediaControlOutput } from "./references";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.control",
	capabilities: ["artifact-read"],
	name: "Read media import settings and archive directory",
});
export default defineScript({
	manifest,
	input: MediaControlInput,
	output: MediaControlOutput,
	run: (input) =>
		Effect.gen(function* () {
			if (input.action === "directory") {
				const directory = yield* listZipEntries({
					limit: 10,
					key: input.key,
					...(input.after === null ? {} : { after: input.after }),
				});
				return { settings: {}, next: directory.next, entries: directory.entries };
			}
			const range = yield* readArtifactRange(0, 16384);
			if (range.size > 16384) {
				throw new Error("Media admitted settings exceed 16 KiB");
			}
			const settings = yield* Schema.decodeEffect(
				Schema.fromJsonString(Schema.Record(Schema.String, jsonValueSchema)),
			)(new TextDecoder("utf-8", { fatal: true }).decode(range.bytes));
			return { settings, next: null, entries: [] };
		}),
});
