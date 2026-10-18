import { afterEach, expect, it } from "@effect/vitest";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

import anilist from "./anilist.sandbox";
import { compareMediaRecords, serializeMediaRecords } from "./collection";
import type { MediaSourceRecord } from "./collection-schemas";
import { mediaFilesystem, mediaStageInput, resetMediaFilesystem } from "./ingestion.test-support";

afterEach(resetMediaFilesystem);
const encoder = new TextEncoder();
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

for (const { volumes, chapters } of [
	{ volumes: 3, chapters: 0 },
	{ volumes: 2, chapters: 3 },
	{ volumes: 0, chapters: 0 },
	{ chapters: 0, volumes: 257 },
	{ volumes: 257, chapters: 129 },
	{ volumes: 0, chapters: 128 },
	{ chapters: 0, volumes: 128 },
]) {
	it.live(
		`imports ${chapters} chapters and ${volumes} volumes in bounded AniList continuations`,
		() =>
			Effect.gen(function* () {
				const fs = mediaFilesystem({
					uploadToken: encoder.encode(
						encodeJson({
							user: { custom_lists: { manga: ["Reading Club"] } },
							lists: [
								{
									id: 1,
									score: 4,
									series_id: 200,
									series_type: 1,
									progress: chapters,
									status: "COMPLETED",
									custom_lists: "[0]",
									progress_volume: volumes,
								},
							],
						}),
					),
				});
				const collected = yield* anilist.run(mediaStageInput());
				expect(collected.done).toBe(true);
				fs.files.set(
					"records",
					encoder.encode(serializeMediaRecords((yield* fs.records()).sort(compareMediaRecords))),
				);
				const input = mediaStageInput({
					action: "normalize",
					settings: { timezone: "Etc/GMT" },
					ingestionArtifacts: { runId: "run", captures: { records: "records" } },
				});
				const records: MediaSourceRecord[] = [];
				let steps = 0;
				for (;;) {
					const result = yield* anilist.run(input);
					const batch = yield* fs.records();
					expect(
						batch
							.flatMap((record) => record.group?.events ?? [])
							.filter((event) => event.eventSchemaSlug === "progress").length,
					).toBeLessThanOrEqual(128);
					records.push(...batch);
					steps++;
					if (result.done) {
						break;
					}
					Object.assign(input, {
						offset: result.offset,
						header: result.header,
						itemIndex: result.itemIndex,
					});
				}
				const events = records.flatMap((record) => record.group?.events ?? []);
				expect(records.flatMap((record) => (record.failure ? [record.failure] : []))).toEqual([]);
				expect(
					events
						.filter((event) => event.properties["mangaChapter"] !== undefined)
						.map((event) => event.properties["mangaChapter"]),
				).toEqual(Array.from({ length: chapters }, (_, index) => index + 1));
				expect(
					events
						.filter((event) => event.properties["mangaVolume"] !== undefined)
						.map((event) => event.properties["mangaVolume"]),
				).toEqual(Array.from({ length: volumes }, (_, index) => index + 1));
				expect(events.filter((event) => event.eventSchemaSlug === "complete")).toHaveLength(1);
				expect(
					events
						.filter((event) => event.eventSchemaSlug === "review")
						.map((event) => event.properties),
				).toEqual([{ rating: 4 }]);
				expect(events).toHaveLength(chapters + volumes + 2);
				expect(new Set(events.map((event) => event.operationId)).size).toBe(events.length);
				expect(records.flatMap((record) => record.group?.collectionMemberships ?? [])).toEqual([
					{ collectionName: "Reading Club" },
				]);
				if (chapters + volumes > 128) {
					expect(steps).toBeGreaterThan(1);
				}
			}),
	);
}
