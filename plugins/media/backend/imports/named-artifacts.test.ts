import type { ExecutionMetadata, SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { gzipSync } from "@ryot-app/sandbox-sdk/fflate";
import { afterEach, expect, it } from "vitest";

import movary from "./movary.sandbox";
import myanimelist from "./myanimelist.sandbox";
import { readImportArtifactText } from "./shared";
import trakt from "./trakt.sandbox";

const filesystemKey = Symbol.for("@ryot-app/sandbox-sdk/filesystem");
const encoder = new TextEncoder();
const host = {} satisfies SandboxHost<["artifact-read"]>;
const execution = {
	metadata: {},
	sandboxScriptId: "named-artifacts-test",
} satisfies ExecutionMetadata;

afterEach(() => {
	Reflect.deleteProperty(globalThis, filesystemKey);
});

it("reads a single upload by the schema field key", async () => {
	const keys: string[] = [];
	Reflect.set(globalThis, filesystemKey, {
		readArtifact: () => Promise.reject(new Error("single artifact must not be read")),
		readNamedArtifact: (key: string) => {
			keys.push(key);
			return Promise.resolve(encoder.encode("export"));
		},
		writeScratchChunks: () => Promise.resolve(),
	});

	await expect(Effect.runPromise(readImportArtifactText())).resolves.toBe("export");
	expect(keys).toEqual(["uploadToken"]);
});

it("reads all three Movary uploads by their declared artifact keys", async () => {
	const keys: string[] = [];
	Reflect.set(globalThis, filesystemKey, {
		readArtifact: () => Promise.reject(new Error("single artifact must not be read")),
		readNamedArtifact: (key: string) => {
			keys.push(key);
			const files: Record<string, string> = {
				historyUploadToken: "title,tmdb_id,watched_at\nArrival,42,2026-01-03",
				ratingsUploadToken: "title,tmdb_id,user_rating\nArrival,42,8",
				watchlistUploadToken: "title,tmdb_id\nArrival,42",
			};
			const text = files[key] ?? "";
			return Promise.resolve(encoder.encode(text));
		},
		writeScratchChunks: () => Promise.resolve(),
	});

	const result = await Effect.runPromise(movary.run({ start: 0, limit: 25 }, host, execution));
	expect(keys).toEqual(["historyUploadToken", "ratingsUploadToken", "watchlistUploadToken"]);
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
	expect(keys).toEqual(["mangaUploadToken"]);
	expect(result.entityGroups[0]?.entityRef).toMatchObject({
		externalId: "202",
		providerSlug: "manga.myanimelist",
	});
});

it("imports a Trakt ZIP without reading plugin configuration", async () => {
	const keys: string[] = [];
	const archive = Buffer.from(
		"UEsDBBQAAAAIAC26Fl2/0MDqWQAAAGMAAAAUAAAAd2F0Y2hlZC1oaXN0b3J5Lmpzb26LrlYqTyxJzkhNiU8sUbJSMjIwMtE1MASiEAMDKzCKUtJRys0vy0xVsqpWKsksyQEylByLijLLEnOAUpkpxWCJosRsoAGGOkoluSlJSlbGRpYWZqa1tbWxAFBLAwQUAAAACAAtuhZdwFZCFjwAAAA/AAAAFAAAAGxpc3RzLXdhdGNobGlzdC5qc29ui65Wys0vy0xVsqpWKsksyQEylByLijLLEnOUdJQyU4rBEkWJ2SVKVoY6SiW5KUlKVsZGlhZmprW1tbEAUEsBAhQAFAAAAAgALboWXb/QwOpZAAAAYwAAABQAAAAAAAAAAAAAAAAAAAAAAHdhdGNoZWQtaGlzdG9yeS5qc29uUEsBAhQAFAAAAAgALboWXcBWQhY8AAAAPwAAABQAAAAAAAAAAAAAAAAAiwAAAGxpc3RzLXdhdGNobGlzdC5qc29uUEsFBgAAAAACAAIAhAAAAPkAAAAAAA==",
		"base64",
	);
	Reflect.set(globalThis, filesystemKey, {
		readArtifact: () => Promise.reject(new Error("single artifact must not be read")),
		readNamedArtifact: (key: string) => {
			keys.push(key);
			return Promise.resolve(archive);
		},
		writeScratchChunks: () => Promise.resolve(),
	});
	const result = await Effect.runPromise(
		trakt.run(
			{ start: 0, limit: 25, mode: "export", hasExportFile: true },
			{
				getPluginConfig: () => Effect.die("plugin config must not be read"),
				httpCall: () => Effect.die("HTTP must not be called"),
			} satisfies SandboxHost<["artifact-read", "httpCall", "getPluginConfig"]>,
			execution,
		),
	);
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
});
