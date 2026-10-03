import { afterEach, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { gzipSync } from "@ryot-app/sandbox-sdk/fflate";

import { mediaFilesystem, resetMediaFilesystem, mediaStageInput } from "./ingestion.test-support";
import movary from "./movary.sandbox";
import myanimelist from "./myanimelist.sandbox";

const encoder = new TextEncoder();
afterEach(resetMediaFilesystem);
it.live("collects each Movary file once and preserves cross-file source indices", () =>
	Effect.gen(function* () {
		const fs = mediaFilesystem({
			watchlistUploadToken: encoder.encode("title,tmdb_id\nArrival,42"),
			ratingsUploadToken: encoder.encode("title,tmdb_id,user_rating\nArrival,42,8"),
			historyUploadToken: encoder.encode("title,tmdb_id,watched_at\nArrival,42,2026-01-03"),
		});
		for (const fileIndex of [0, 1, 2]) {
			const result = yield* movary.run(mediaStageInput({ fileIndex, itemIndex: fileIndex }));
			expect(result.done).toBe(true);
			expect((yield* fs.records()).map((record) => record.itemIndex)).toEqual([fileIndex]);
		}
		expect(fs.reads.map((read) => read.key)).toEqual([
			"historyUploadToken",
			"ratingsUploadToken",
			"watchlistUploadToken",
		]);
	}),
);
it.live("collects only the selected gzip XML grant and captures normalized events", () =>
	Effect.gen(function* () {
		const fs = mediaFilesystem({
			mangaUploadToken: gzipSync(
				encoder.encode(
					"<myanimelist><manga><manga_mangadb_id>202</manga_mangadb_id><manga_title>Vinland Saga</manga_title><my_read_chapters>0</my_read_chapters><my_score>0</my_score><my_status>Plan to Read</my_status></manga></myanimelist>",
				),
			),
		});
		const result = yield* myanimelist.run(mediaStageInput({ fileIndex: 1 }));
		expect(result.done).toBe(true);
		expect((yield* fs.records())[0]?.group).toMatchObject({
			entityRef: { externalId: "202", providerSlug: "manga.myanimelist" },
			events: [{ eventSchemaSlug: "backlog", occurredAt: "2026-01-01T00:00:00.000Z" }],
		});
		expect(fs.reads.every((read) => read.key === "mangaUploadToken")).toBe(true);
	}),
);
