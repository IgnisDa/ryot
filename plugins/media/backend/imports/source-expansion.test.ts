import { afterEach, expect, it } from "@effect/vitest";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { gzipSync } from "@ryot-app/sandbox-sdk/fflate";

import { compareMediaRecords, serializeMediaRecords } from "./collection";
import type { MediaSourceRecord } from "./collection-schemas";
import goodreads from "./goodreads.sandbox";
import { mediaFilesystem, resetMediaFilesystem, mediaStageInput } from "./ingestion.test-support";
import myanimelist from "./myanimelist.sandbox";
import spotify from "./spotify.sandbox";

afterEach(resetMediaFilesystem);
const encoder = new TextEncoder();
const play = (ts: string, name: string) => ({
	ts,
	ms_played: 60000,
	reason_end: "trackdone",
	master_metadata_track_name: name,
	spotify_track_uri: "spotify:track:a",
});
it.live(
	"expands a Goodreads read count over multiple source steps without refetching file bytes",
	() =>
		Effect.gen(function* () {
			const bytes = encoder.encode(
				"Title,ISBN13,Bookshelves,Read Count\nBook,9780306406157,read,513",
			);
			const fs = mediaFilesystem({ uploadToken: bytes });
			let input = mediaStageInput({ itemIndex: 42 });
			const records: MediaSourceRecord[] = [];
			let steps = 0;
			for (;;) {
				const result = yield* goodreads.run(input);
				records.push(...(yield* fs.records()));
				steps++;
				if (result.done) {
					expect(result.itemIndex).toBe(43);
					break;
				}
				if (result.carryFile) {
					fs.files.set("carry", fs.scratch.get(result.carryFile) ?? new Uint8Array());
				}
				Object.assign(input, {
					offset: result.offset,
					header: result.header,
					itemIndex: result.itemIndex,
					eventOffset: result.eventOffset,
					ingestionArtifacts: { runId: "run", captures: { carry: "carry" } },
				});
			}
			expect(steps).toBeGreaterThan(1);
			expect(records).toHaveLength(513);
			expect(
				new Set(
					records.flatMap((record) => record.group?.events.map((event) => event.operationId) ?? []),
				).size,
			).toBe(513);
			expect(records.every((record) => record.itemIndex === 42)).toBe(true);
			expect(
				fs.reads.filter((read) => read.key === "uploadToken" && read.offset < bytes.length),
			).toHaveLength(1);
		}),
);
it.live("expands gzip XML coverage in bounded steps and ignores closing tags inside CDATA", () =>
	Effect.gen(function* () {
		const fs = mediaFilesystem({
			mangaUploadToken: gzipSync(
				encoder.encode(
					"<myanimelist><manga><manga_mangadb_id>42</manga_mangadb_id><manga_title><![CDATA[Title </manga> é]]></manga_title><my_read_chapters>513</my_read_chapters><my_score>0</my_score><my_status>Plan to Read</my_status></manga></myanimelist>",
				),
			),
		});
		let input = mediaStageInput({ fileIndex: 1 });
		const records: MediaSourceRecord[] = [];
		let steps = 0;
		for (;;) {
			const result = yield* myanimelist.run(input);
			records.push(...(yield* fs.records()));
			steps++;
			if (result.done) {
				break;
			}
			fs.files.set("carry", fs.scratch.get("carry.bin") ?? new Uint8Array());
			Object.assign(input, {
				offset: result.offset,
				header: result.header,
				itemIndex: result.itemIndex,
				ingestionArtifacts: { runId: "run", captures: { carry: "carry" } },
			});
		}
		expect(steps).toBeGreaterThan(1);
		const events = records.flatMap((record) => record.group?.events ?? []);
		expect(
			events
				.filter((event) => event.eventSchemaSlug === "progress")
				.map((event) => event.properties["mangaChapter"]),
		).toEqual(Array.from({ length: 513 }, (_, index) => index + 1));
		expect(events.filter((event) => event.eventSchemaSlug === "backlog")).toHaveLength(1);
		expect(new Set(events.map((event) => event.operationId)).size).toBe(514);
		expect(records[0]?.group?.entityRef.sourceLabel).toBe("Title </manga> é");
	}),
);
it.live(
	"deduplicates exact Spotify source timestamps while keeping distinct equal-time plays in original order",
	() =>
		Effect.gen(function* () {
			const fs = mediaFilesystem({
				uploadToken: encoder.encode(
					yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))([
						play("2026-01-01T00:00:00Z", "First"),
						play("2025-12-31T19:00:00-05:00", "Second"),
						play("2026-01-01T00:00:00Z", "Duplicate"),
					]),
				),
			});
			yield* spotify.run(mediaStageInput());
			const raw = (yield* fs.records()).sort(compareMediaRecords);
			fs.files.set("records", encoder.encode(serializeMediaRecords(raw)));
			yield* spotify.run(
				mediaStageInput({
					action: "normalize",
					ingestionArtifacts: { runId: "run", captures: { records: "records" } },
				}),
			);
			const records = (yield* fs.records()).sort(compareMediaRecords);
			expect(records.map((record) => record.itemIndex)).toEqual([0, 1]);
			expect(records.map((record) => record.group?.events[0]?.attribution?.sourceLabel)).toEqual([
				"First",
				"Second",
			]);
			expect(records.map((record) => record.group?.events[0]?.occurredAt)).toEqual([
				"2026-01-01T00:00:00.000Z",
				"2026-01-01T00:00:00.000Z",
			]);
		}),
);
