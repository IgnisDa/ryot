import { afterEach, expect, it } from "@effect/vitest";
import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { gzipSync } from "@ryot-app/sandbox-sdk/fflate";

import movary from "./movary.sandbox";
import myanimelist from "./myanimelist.sandbox";
import { readImportArtifactText } from "./shared";
import trakt from "./trakt.sandbox";

const filesystemKey = Symbol.for("@ryot-app/sandbox-sdk/filesystem");
const encoder = new TextEncoder();

afterEach(() => {
	Reflect.deleteProperty(globalThis, filesystemKey);
});

it.live("reads a single upload by the schema field key", () =>
	Effect.gen(function* () {
		const keys: string[] = [];
		Reflect.set(globalThis, filesystemKey, {
			writeScratchChunks: () => Promise.resolve(),
			readArtifact: () => Promise.reject(new Error("single artifact must not be read")),
			readNamedArtifact: (key: string) => {
				keys.push(key);
				return Promise.resolve(encoder.encode("export"));
			},
		});

		expect(yield* readImportArtifactText).toBe("export");
		expect(keys).toEqual(["uploadToken"]);
	}),
);

it.live("reads all three Movary uploads by their declared artifact keys", () =>
	Effect.gen(function* () {
		const keys: string[] = [];
		Reflect.set(globalThis, filesystemKey, {
			writeScratchChunks: () => Promise.resolve(),
			readArtifact: () => Promise.reject(new Error("single artifact must not be read")),
			readNamedArtifact: (key: string) => {
				keys.push(key);
				const files: Record<string, string> = {
					watchlistUploadToken: "title,tmdb_id\nArrival,42",
					ratingsUploadToken: "title,tmdb_id,user_rating\nArrival,42,8",
					historyUploadToken: "title,tmdb_id,watched_at\nArrival,42,2026-01-03",
				};
				const text = files[key] ?? "";
				return Promise.resolve(encoder.encode(text));
			},
		});

		const result = yield* movary.run({ start: 0, limit: 25 });
		expect(keys).toEqual(["historyUploadToken", "ratingsUploadToken", "watchlistUploadToken"]);
		expect(result.totalItems).toBe(3);
	}),
);

it.live("reads only the supplied optional MyAnimeList named artifact", () =>
	Effect.gen(function* () {
		const keys: string[] = [];
		Reflect.set(globalThis, filesystemKey, {
			writeScratchChunks: () => Promise.resolve(),
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
		});

		const result = yield* myanimelist.run({
			start: 0,
			limit: 25,
			hasMangaFile: true,
			hasAnimeFile: false,
		});
		expect(keys).toEqual(["mangaUploadToken"]);
		expect(result.entityGroups[0]?.entityRef).toMatchObject({
			externalId: "202",
			providerSlug: "manga.myanimelist",
		});
	}),
);

it.live("imports a Trakt ZIP without reading plugin configuration", () =>
	Effect.gen(function* () {
		const keys: string[] = [];
		const archive = Buffer.from(
			"UEsDBBQAAAAIAC26Fl2/0MDqWQAAAGMAAAAUAAAAd2F0Y2hlZC1oaXN0b3J5Lmpzb26LrlYqTyxJzkhNiU8sUbJSMjIwMtE1MASiEAMDKzCKUtJRys0vy0xVsqpWKsksyQEylByLijLLEnOAUpkpxWCJosRsoAGGOkoluSlJSlbGRpYWZqa1tbWxAFBLAwQUAAAACAAtuhZdwFZCFjwAAAA/AAAAFAAAAGxpc3RzLXdhdGNobGlzdC5qc29ui65Wys0vy0xVsqpWKsksyQEylByLijLLEnOUdJQyU4rBEkWJ2SVKVoY6SiW5KUlKVsZGlhZmprW1tbEAUEsBAhQAFAAAAAgALboWXb/QwOpZAAAAYwAAABQAAAAAAAAAAAAAAAAAAAAAAHdhdGNoZWQtaGlzdG9yeS5qc29uUEsBAhQAFAAAAAgALboWXcBWQhY8AAAAPwAAABQAAAAAAAAAAAAAAAAAiwAAAGxpc3RzLXdhdGNobGlzdC5qc29uUEsFBgAAAAACAAIAhAAAAPkAAAAAAA==",
			"base64",
		);
		Reflect.set(globalThis, filesystemKey, {
			writeScratchChunks: () => Promise.resolve(),
			readArtifact: () => Promise.reject(new Error("single artifact must not be read")),
			readNamedArtifact: (key: string) => {
				keys.push(key);
				return Promise.resolve(archive);
			},
		});
		const result = yield* trakt.run({ start: 0, limit: 25, mode: "export", hasExportFile: true }, {
			httpCall: () => Effect.die("HTTP must not be called"),
			getPluginConfig: () => Effect.die("plugin config must not be read"),
		} satisfies SandboxHost<["artifact-read", "httpCall", "getPluginConfig"]>);
		expect(keys).toEqual(["exportUploadToken"]);
		expect(result).toMatchObject({
			failures: [],
			totalItems: 2,
			entityGroups: [
				{
					events: [{ eventSchemaSlug: "complete" }],
					collectionMemberships: [{ collectionName: "Watchlist" }],
					entityRef: { externalId: "329865", providerSlug: "movie.tmdb" },
				},
			],
		});
	}),
);
