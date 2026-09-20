import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

import {
	collectMediaJson,
	compareMediaRecords,
	mediaRecordReader,
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
const Identity = Schema.Struct({
	ts: Schema.NullishOr(Schema.String),
	spotify_track_uri: Schema.NullishOr(Schema.String),
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
						const identity = Schema.decodeUnknownSync(Identity)(raw);
						const dedupKey = JSON.stringify([identity.spotify_track_uri, identity.ts]);
						return normalizeMediaRecords(result, itemIndex, "spotify").map((record) =>
							Object.assign(record, { dedupKey, key: dedupKey }),
						);
					},
				);
			}
			const read = mediaRecordReader();
			let offset = input.offset;
			let header = input.header;
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
				if (!record.dedupKey) {
					throw new Error("Spotify captured record is missing its exact-play identity");
				}
				if (record.dedupKey === header) {
					continue;
				}
				header = record.dedupKey;
				const normalized = normalizeMediaRecords(
					{
						entityGroups: record.group ? [{ ...record.group, itemIndex: 0 }] : [],
						failures: record.failure ? [{ ...record.failure, itemIndex: 0 }] : [],
					},
					record.itemIndex,
					"spotify",
					record.eventIndex,
				).map((result) => Object.assign(result, { dedupKey: record.dedupKey }));
				records.push(...normalized);
				bytes += new TextEncoder().encode(serializeMediaRecords(normalized)).length;
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
				header,
				itemIndex,
			});
		}),
});
