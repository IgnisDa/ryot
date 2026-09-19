import { afterEach, expect, it } from "@effect/vitest";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

import { compareMediaRecords, serializeMediaRecords } from "./collection";
import type { MediaSourceRecord } from "./collection-schemas";
import { mediaFilesystem, mediaFilesystemKey, mediaStageInput } from "./ingestion.test-support";
import type { MediaReadBatchOutput } from "./process";
import reader from "./read-batch.sandbox";
import spotify from "./spotify.sandbox";

afterEach(() => Reflect.deleteProperty(globalThis, mediaFilesystemKey));
const row = (index: number) => ({
	ms_played: 60000,
	reason_end: "trackdone",
	padding: "x".repeat(12000),
	master_metadata_track_name: "A",
	spotify_track_uri: "spotify:track:a",
	ts: `2026-01-01T00:${String(index).padStart(2, "0")}:00Z`,
});
it.live(
	"collects multiple history files and windows, then deduplicates across application batches",
	() =>
		Effect.gen(function* () {
			const rows = Array.from({ length: 40 }, (_, index) => row(index));
			const encoder = new TextEncoder();
			const fs = mediaFilesystem({
				uploadToken: encoder.encode(
					yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(rows),
				),
			});
			const records: MediaSourceRecord[] = [];
			for (let file = 0; file < 2; file++) {
				if (file) {
					fs.files.set(
						"uploadToken",
						encoder.encode(
							yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))([row(20), row(39)]),
						),
					);
				}
				let input = mediaStageInput({ itemIndex: file ? 40 : 0 });
				for (;;) {
					const result = yield* spotify.run(input);
					records.push(...(yield* fs.records()));
					if (result.done) {
						break;
					}
					if (result.carryFile) {
						fs.files.set("carry", fs.scratch.get(result.carryFile) ?? new Uint8Array());
					}
					Object.assign(input, {
						offset: result.offset,
						header: result.header,
						itemIndex: result.itemIndex,
						...(result.carryFile
							? { ingestionArtifacts: { runId: "run", captures: { carry: "carry" } } }
							: {}),
					});
				}
			}
			fs.files.set(
				"records",
				encoder.encode(serializeMediaRecords(records.sort(compareMediaRecords))),
			);
			let offset = 0;
			let itemIndex = 0;
			let dedupKey: string | null = null;
			const events = [];
			for (;;) {
				const batch: typeof MediaReadBatchOutput.Type = yield* reader.run({
					offset,
					dedupKey,
					itemIndex,
					ingestionArtifacts: { runId: "run", captures: { records: "records" } },
				});
				events.push(...batch.batch.entityGroups.flatMap((group) => group.events));
				expect(batch.batch.entityGroups.every((group) => group.events.length <= 6)).toBe(true);
				({ offset, dedupKey, itemIndex } = batch);
				if (batch.done) {
					break;
				}
			}
			expect(events).toHaveLength(40);
			expect(events.map((event) => event.occurredAt)).toEqual(
				rows.map((play) => play.ts.replace("Z", ".000Z")),
			);
			expect(new Set(events.map((event) => event.operationId)).size).toBe(40);
			expect(
				fs.reads.filter((read) => read.key === "uploadToken" && read.offset > 0).length,
			).toBeGreaterThan(0);
		}),
);
