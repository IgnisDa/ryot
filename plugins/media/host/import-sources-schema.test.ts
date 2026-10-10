import { CreateImportRunBody } from "@ryot-app/contract/modules/imports/schemas";
import { Schema } from "effect";
import { expect, it } from "vitest";

import { createMediaImportRunBody, MediaCreateImportRunBody } from "./import-sources";
import { mediaPlugin } from "./plugin";

const uploadToken = "upload-1";

it("builds a typed media request accepted by the open import envelope", () => {
	const body = createMediaImportRunBody({ uploadToken, source: "igdb", collection: "Favorites" });

	expect(Schema.decodeSync(CreateImportRunBody)(body)).toEqual(body);
	expect(body.collection).toBe("Favorites");
});

it("keeps media-specific request validation in the media plugin", () => {
	expect(() =>
		Schema.decodeUnknownSync(MediaCreateImportRunBody)({ uploadToken, source: "igdb" }),
	).toThrow();
});

it.each([
	["API key", "plex", "apiKey", { apiKey: "", source: "plex", apiUrl: "https://plex.example" }],
	["Trakt username", "trakt", "username", { mode: "user", username: "", source: "trakt" }],
	[
		"Trakt collection",
		"trakt",
		"collection",
		{
			mode: "list",
			collection: "",
			source: "trakt",
			url: "https://trakt.tv/users/alice/lists/favorites",
		},
	],
	["IGDB collection", "igdb", "collection", { uploadToken, source: "igdb", collection: "" }],
	[
		"Jellyfin username",
		"jellyfin",
		"username",
		{ username: "", source: "jellyfin", apiUrl: "https://jellyfin.example" },
	],
])(
	"rejects an empty required %s in both manifest metadata and the plugin guard",
	(_, slug, field, body) => {
		const source = mediaPlugin.importSources.find((candidate) => candidate.slug === slug);
		const definition =
			source && Object.entries(source.inputSchema.fields).find(([key]) => key === field)?.[1];

		expect(definition?.validation).toMatchObject({ minLength: 1, required: true });
		expect(() => Schema.decodeUnknownSync(MediaCreateImportRunBody)(body)).toThrow();
	},
);

it("keeps Jellyfin password optional but rejects it when supplied empty", () => {
	const source = mediaPlugin.importSources.find(({ slug }) => slug === "jellyfin");
	const fields = source?.inputSchema.fields;
	const password = fields && "password" in fields ? fields.password : undefined;

	expect(password?.validation).toEqual({ minLength: 1 });
	expect(() =>
		Schema.decodeSync(MediaCreateImportRunBody)({
			password: "",
			username: "alice",
			source: "jellyfin",
			apiUrl: "https://jellyfin.example",
		}),
	).toThrow();
});

it.each([
	[
		"Netflix profile name",
		"netflix",
		"profileName",
		{ uploadToken, source: "netflix", profileName: null },
	],
	[
		"Plex insecure-connections flag",
		"plex",
		"allowInsecureConnections",
		{
			source: "plex",
			apiKey: "secret",
			apiUrl: "https://plex.example",
			allowInsecureConnections: null,
		},
	],
	[
		"Jellyfin password and insecure-connections flag",
		"jellyfin",
		"password",
		{
			password: null,
			username: "alice",
			source: "jellyfin",
			allowInsecureConnections: null,
			apiUrl: "https://jellyfin.example",
		},
	],
])("accepts a null optional %s in both the manifest and plugin guard", (_, slug, field, body) => {
	const source = mediaPlugin.importSources.find((candidate) => candidate.slug === slug);
	const definition =
		source && Object.entries(source.inputSchema.fields).find(([key]) => key === field)?.[1];

	expect(definition?.validation?.required).not.toBe(true);
	expect(Schema.decodeUnknownSync(MediaCreateImportRunBody)(body)).toEqual(body);
});

it("accepts explicit Trakt export, user, and list requests", () => {
	const exportFile = createMediaImportRunBody({
		mode: "export",
		source: "trakt",
		exportUploadToken: uploadToken,
	});
	const user = createMediaImportRunBody({ mode: "user", source: "trakt", username: "alice" });
	const list = createMediaImportRunBody({
		mode: "list",
		source: "trakt",
		collection: "Favorites",
		url: "https://trakt.tv/users/alice/lists/favorites",
	});

	expect(Schema.decodeSync(MediaCreateImportRunBody)(exportFile)).toEqual(exportFile);
	expect(Schema.decodeSync(MediaCreateImportRunBody)(user)).toEqual(user);
	expect(Schema.decodeSync(MediaCreateImportRunBody)(list)).toEqual(list);
});

it.each([
	["legacy user request", { source: "trakt", username: "alice" }],
	["user request without a username", { mode: "user", source: "trakt" }],
	[
		"mixed user and list request",
		{
			mode: "user",
			source: "trakt",
			username: "alice",
			collection: "Favorites",
			url: "https://trakt.tv/users/alice/lists/favorites",
		},
	],
	["export request without a file", { mode: "export", source: "trakt" }],
	[
		"mixed export and user request",
		{ mode: "export", source: "trakt", username: "alice", exportUploadToken: uploadToken },
	],
	[
		"list request without a collection",
		{ mode: "list", source: "trakt", url: "https://trakt.tv/users/alice/lists/favorites" },
	],
	[
		"mixed list and user request",
		{
			mode: "list",
			source: "trakt",
			username: "alice",
			collection: "Favorites",
			url: "https://trakt.tv/users/alice/lists/favorites",
		},
	],
	[
		"list request with an invalid URL",
		{ mode: "list", source: "trakt", url: "not-a-url", collection: "Favorites" },
	],
])("rejects $0", (_, body) => {
	expect(() => Schema.decodeUnknownSync(MediaCreateImportRunBody)(body)).toThrow();
});

it("accepts either MyAnimeList export and rejects an empty pair", () => {
	for (const body of [
		{ source: "myanimelist", animeUploadToken: uploadToken },
		{ source: "myanimelist", mangaUploadToken: uploadToken },
		{ source: "myanimelist", animeUploadToken: uploadToken, mangaUploadToken: uploadToken },
	]) {
		expect(Schema.decodeUnknownSync(MediaCreateImportRunBody)(body)).toEqual(body);
	}
	expect(() => Schema.decodeSync(MediaCreateImportRunBody)({ source: "myanimelist" })).toThrow();
	expect(() =>
		Schema.decodeUnknownSync(MediaCreateImportRunBody)({
			source: "myanimelist",
			animeUploadToken: null,
			mangaUploadToken: null,
		}),
	).toThrow();
});

it("requires a timezone for AniList", () => {
	expect(() =>
		Schema.decodeUnknownSync(MediaCreateImportRunBody)({ uploadToken, source: "anilist" }),
	).toThrow();
});

it("keeps every manifest source aligned with a strict plugin-owned guard", () => {
	const validBodies = {
		imdb: { uploadToken, source: "imdb" },
		grouvee: { uploadToken, source: "grouvee" },
		spotify: { uploadToken, source: "spotify" },
		watcharr: { uploadToken, source: "watcharr" },
		hardcover: { uploadToken, source: "hardcover" },
		goodreads: { uploadToken, source: "goodreads" },
		storygraph: { uploadToken, source: "storygraph" },
		trakt: { mode: "user", source: "trakt", username: "alice" },
		igdb: { uploadToken, source: "igdb", collection: "Favorites" },
		netflix: { uploadToken, source: "netflix", profileName: "Kids" },
		anilist: { uploadToken, source: "anilist", timezone: "Asia/Kolkata" },
		myanimelist: { source: "myanimelist", animeUploadToken: uploadToken },
		plex: { source: "plex", apiKey: "secret", apiUrl: "https://plex.example" },
		jellyfin: { username: "alice", source: "jellyfin", apiUrl: "https://jellyfin.example" },
		media_tracker: {
			apiKey: "secret",
			source: "media_tracker",
			apiUrl: "https://media-tracker.example",
		},
		audiobookshelf: {
			apiKey: "secret",
			source: "audiobookshelf",
			apiUrl: "https://audiobookshelf.example",
		},
		movary: {
			source: "movary",
			historyUploadToken: uploadToken,
			ratingsUploadToken: uploadToken,
			watchlistUploadToken: uploadToken,
		},
	} as const;

	expect(mediaPlugin.importSources.map(({ slug }) => slug).sort()).toEqual(
		Object.keys(validBodies).sort(),
	);
	for (const body of Object.values(validBodies)) {
		expect(Schema.decodeSync(MediaCreateImportRunBody)(body)).toEqual(body);
		expect(() =>
			Schema.decodeUnknownSync(MediaCreateImportRunBody)({ ...body, undeclared: true }),
		).toThrow();
	}
});

it("accepts unknown JSON-compatible sources only through the generic envelope", () => {
	expect(
		Schema.decodeSync(CreateImportRunBody)({
			source: "fixture_source",
			options: { limit: 10, dryRun: true },
		}),
	).toEqual({ source: "fixture_source", options: { limit: 10, dryRun: true } });
	expect(() => Schema.decodeSync(CreateImportRunBody)({ source: "", value: "invalid" })).toThrow();
	expect(() =>
		Schema.decodeSync(CreateImportRunBody)({ value: Number.NaN, source: "fixture_source" }),
	).toThrow();
});
