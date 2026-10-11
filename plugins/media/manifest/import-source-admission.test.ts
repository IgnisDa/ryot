import { expect, it } from "@effect/vitest";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { parseRegistryImportSourceInput } from "@ryot-app/kernel-backend/modules/imports/runtime/source-metadata";
import { Effect } from "effect";

import { mediaPlugin } from "./plugin";

const uploadToken = "upload-1";

const admit = Effect.fn(function* (slug: string, properties: Record<string, JsonValue>) {
	const source = mediaPlugin.importSources.find((candidate) => candidate.slug === slug);
	if (!source) {
		return yield* Effect.die(`Missing media import source: ${slug}`);
	}
	return yield* parseRegistryImportSourceInput(source, {
		...properties,
		source: { slug, owner: definitionOwner("media-owner") },
	});
});

const validInputs = {
	imdb: { uploadToken },
	grouvee: { uploadToken },
	spotify: { uploadToken },
	watcharr: { uploadToken },
	hardcover: { uploadToken },
	goodreads: { uploadToken },
	storygraph: { uploadToken },
	trakt: { mode: "user", username: "alice" },
	netflix: { uploadToken, profileName: "Kids" },
	igdb: { uploadToken, collection: "Favorites" },
	myanimelist: { animeUploadToken: uploadToken },
	anilist: { uploadToken, timezone: "Asia/Kolkata" },
	plex: { apiKey: "secret", apiUrl: "https://plex.example" },
	jellyfin: { username: "alice", apiUrl: "https://jellyfin.example" },
	media_tracker: { apiKey: "secret", apiUrl: "https://media-tracker.example" },
	audiobookshelf: { apiKey: "secret", apiUrl: "https://audiobookshelf.example" },
	movary: {
		historyUploadToken: uploadToken,
		ratingsUploadToken: uploadToken,
		watchlistUploadToken: uploadToken,
	},
};

it.effect("admits each manifest source and rejects its unknown fields", () =>
	Effect.gen(function* () {
		expect(mediaPlugin.importSources.map(({ slug }) => slug).sort()).toEqual(
			Object.keys(validInputs).sort(),
		);
		for (const [slug, properties] of Object.entries(validInputs)) {
			expect(yield* admit(slug, properties)).toEqual(properties);
			const error = yield* Effect.flip(admit(slug, { ...properties, undeclared: true }));
			expect(error).toContain("Import source input is invalid:");
			expect(error).toContain("undeclared");
		}
	}),
);

it.effect.each([
	["plex", "apiKey", { apiKey: "", apiUrl: "https://plex.example" }],
	["trakt", "username", { mode: "user", username: "" }],
	[
		"trakt",
		"collection",
		{ mode: "list", collection: "", url: "https://trakt.tv/users/alice/lists/favorites" },
	],
	["igdb", "collection", { uploadToken, collection: "" }],
	["igdb", "collection", { uploadToken }],
	["jellyfin", "username", { username: "", apiUrl: "https://jellyfin.example" }],
	["jellyfin", "password", { password: "", username: "alice", apiUrl: "https://jellyfin.example" }],
] as const)("rejects invalid source input %j %#", ([slug, field, properties]) =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(admit(slug, properties));
		expect(error).toContain("Import source input is invalid:");
		expect(error).toContain(field);
	}),
);

it.effect.each([
	["netflix", { uploadToken, profileName: null }],
	["plex", { apiKey: "secret", apiUrl: "https://plex.example", allowInsecureConnections: null }],
	[
		"jellyfin",
		{
			password: null,
			username: "alice",
			allowInsecureConnections: null,
			apiUrl: "https://jellyfin.example",
		},
	],
] as const)("admits null optional fields %j", ([slug, properties]) =>
	Effect.gen(function* () {
		expect(yield* admit(slug, properties)).toEqual(properties);
	}),
);

it.effect.each<Record<string, JsonValue>>([
	{ mode: "export", exportUploadToken: uploadToken },
	{ mode: "user", username: "alice" },
	{ mode: "list", collection: "Favorites", url: "https://trakt.tv/users/alice/lists/favorites" },
] as const)("admits Trakt $mode input", (properties) =>
	Effect.gen(function* () {
		expect(yield* admit("trakt", properties)).toEqual(properties);
	}),
);

it.effect.each([
	["mode", {}],
	["username", { username: "alice" }],
	["mode", { mode: "unknown" }],
	["mode", { mode: null }],
	["username", { mode: "user" }],
	["username", { mode: "user", username: null }],
	[
		"collection",
		{
			mode: "user",
			username: "alice",
			collection: "Favorites",
			url: "https://trakt.tv/users/alice/lists/favorites",
		},
	],
	["exportUploadToken", { mode: "export" }],
	["exportUploadToken", { mode: "export", exportUploadToken: null }],
	["username", { mode: "export", username: "alice", exportUploadToken: uploadToken }],
	["exportUploadToken", { mode: "user", username: "alice", exportUploadToken: uploadToken }],
	["collection", { mode: "list", url: "https://trakt.tv/users/alice/lists/favorites" }],
	[
		"username",
		{
			mode: "list",
			username: "alice",
			collection: "Favorites",
			url: "https://trakt.tv/users/alice/lists/favorites",
		},
	],
	["url", { mode: "list", url: "not-a-url", collection: "Favorites" }],
] as const)("rejects invalid Trakt input %j %#", ([field, properties]) =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(admit("trakt", properties));
		expect(error).toContain("Import source input is invalid:");
		expect(error).toContain(field);
	}),
);

it.effect.each<Record<string, JsonValue>>([
	{ animeUploadToken: uploadToken },
	{ mangaUploadToken: uploadToken },
	{ animeUploadToken: uploadToken, mangaUploadToken: uploadToken },
	{ mangaUploadToken: null, animeUploadToken: uploadToken },
	{ animeUploadToken: null, mangaUploadToken: uploadToken },
] as const)("admits MyAnimeList export alternatives %#", (properties) =>
	Effect.gen(function* () {
		expect(yield* admit("myanimelist", properties)).toEqual(properties);
	}),
);

it.effect.each<Record<string, JsonValue>>([
	{},
	{ animeUploadToken: null, mangaUploadToken: null },
	{ animeUploadToken: "" },
	{ mangaUploadToken: "" },
] as const)("rejects MyAnimeList input without a usable export %#", (properties) =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(admit("myanimelist", properties));
		expect(error).toContain("Import source input is invalid:");
		expect(error).toContain("UploadToken");
	}),
);

it.effect.each<Record<string, JsonValue>>([
	{},
	{ timezone: null },
	{ timezone: "" },
	{ timezone: "not-a-timezone" },
])("rejects missing or invalid AniList timezone %#", (properties) =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(admit("anilist", { uploadToken, ...properties }));
		expect(error).toContain("Import source input is invalid:");
		expect(error).toContain("timezone");
	}),
);
