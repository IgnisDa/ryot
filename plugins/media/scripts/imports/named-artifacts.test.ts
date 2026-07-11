import type { ExecutionMetadata, SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { gzipSync } from "@ryot/sandbox-sdk/fflate";
import { afterEach, expect, it } from "vitest";

import movary from "./movary.sandbox";
import myanimelist from "./myanimelist.sandbox";

const filesystemKey = Symbol.for("@ryot/sandbox-sdk/filesystem");
const encoder = new TextEncoder();
const host = {} satisfies SandboxHost<["artifact-read"]>;
const execution = {
	metadata: {},
	sandboxScriptId: "named-artifacts-test",
} satisfies ExecutionMetadata;

afterEach(() => {
	Reflect.deleteProperty(globalThis, filesystemKey);
});

it("reads all three Movary uploads by their declared artifact keys", async () => {
	const keys: string[] = [];
	Reflect.set(globalThis, filesystemKey, {
		readArtifact: () => Promise.reject(new Error("single artifact must not be read")),
		readNamedArtifact: (key: string) => {
			keys.push(key);
			const files: Record<string, string> = {
				historyFilePath: "title,tmdb_id,watched_at\nArrival,42,2026-01-03",
				ratingsFilePath: "title,tmdb_id,user_rating\nArrival,42,8",
				watchlistFilePath: "title,tmdb_id\nArrival,42",
			};
			const text = files[key] ?? "";
			return Promise.resolve(encoder.encode(text));
		},
		writeScratchChunks: () => Promise.resolve(),
	});

	const result = await Effect.runPromise(movary.run({ start: 0, limit: 25 }, host, execution));
	expect(keys).toEqual(["historyFilePath", "ratingsFilePath", "watchlistFilePath"]);
	expect(result.totalItems).toBe(3);
});

it("reads only the supplied optional MyAnimeList named artifact", async () => {
	const keys: string[] = [];
	Reflect.set(globalThis, filesystemKey, {
		readArtifact: () => Promise.reject(new Error("single artifact must not be read")),
		readNamedArtifact: (key: string) => {
			keys.push(key);
			return Promise.resolve(
				gzipSync(
					encoder.encode(
						"<myanimelist><manga><manga_mangadb_id>202</manga_mangadb_id><manga_title>Vinland Saga</manga_title><my_read_chapters>0</my_read_chapters><my_start_date>0000-00-00</my_start_date><my_finish_date>0000-00-00</my_finish_date><my_score>0</my_score><my_status>Plan to Read</my_status></manga></myanimelist>",
					),
				),
			);
		},
		writeScratchChunks: () => Promise.resolve(),
	});

	const result = await Effect.runPromise(
		myanimelist.run(
			{ start: 0, limit: 25, hasAnimeFile: false, hasMangaFile: true },
			host,
			execution,
		),
	);
	expect(keys).toEqual(["mangaFilePath"]);
	expect(result.entityGroups[0]?.entityRef).toMatchObject({
		externalId: "202",
		providerSlug: "manga.myanimelist",
	});
});
