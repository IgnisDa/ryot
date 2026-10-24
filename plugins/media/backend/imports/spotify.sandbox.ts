import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";

import {
	collectMediaJson,
	compareMediaRecords,
	mediaNormalizedRecordReader,
	normalizeMediaRecords,
	serializeMediaRecords,
	sourceOutput,
	WINDOW_BYTES,
	writeMediaCapture,
} from "./collection";
import { MediaSourceInput, MediaSourceOutput, type MediaSourceRecord } from "./collection-schemas";
import { adaptSpotifyStreamingHistory } from "./spotify";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.spotify",
	name: "Collect Spotify history",
});
export default defineScript({
	manifest,
	input: MediaSourceInput,
	output: MediaSourceOutput,
	run: (input) =>
		Effect.gen(function* () {
			if (input.action !== "normalize") {
				return yield* collectMediaJson(
					"spotify",
					input,
					() => ({ failures: [], entityGroups: [] }),
					"uploadToken",
					(raw, itemIndex) => {
						const result = adaptSpotifyStreamingHistory([
							{ rows: [raw], name: input.entry?.name ?? "history.json" },
						]);
						return normalizeMediaRecords(result, itemIndex, "spotify");
					},
				);
			}
			const read = mediaNormalizedRecordReader();
			let offset = input.offset;
			let itemIndex = input.itemIndex;
			let done = false;
			const records: MediaSourceRecord[] = [];
			let bytes = 0;
			for (let count = 0; count < 100; count++) {
				const next = yield* read("records", offset);
				if (!next) {
					done = true;
					break;
				}
				offset = next.next;
				itemIndex++;
				const record = next.record;
				records.push(record);
				bytes += new TextEncoder().encode(serializeMediaRecords([record])).length;
				if (bytes >= WINDOW_BYTES) {
					break;
				}
			}
			return yield* sourceOutput({
				...(yield* writeMediaCapture([
					{
						name: "records.jsonl",
						contents: serializeMediaRecords(records.sort(compareMediaRecords)),
					},
				])),
				done,
				offset,
				itemIndex,
				header: input.header,
			});
		}),
});
