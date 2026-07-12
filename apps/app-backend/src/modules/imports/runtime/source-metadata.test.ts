import { expect, it } from "@effect/vitest";
import { Effect, Option, Redacted } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { makeAppConfigLayer } from "#lib/test-utils/effect";
import type { RegisteredImportSource } from "#modules/plugins/import-source-catalog";

import { registryImportSourceFileInputs, registryImportSourceStartError } from "./source-metadata";

type SingleImportSource = Extract<RegisteredImportSource, { readonly lot: "single" }>;

const registeredSource = (overrides: Partial<SingleImportSource> = {}) =>
	({
		lot: "single",
		input: "file",
		name: "Netflix",
		slug: "netflix",
		pluginSlug: "media",
		requiredAppConfigKeys: [],
		description: "Netflix export",
		workflowSlug: "netflix-import",
		allowedFileExtensions: ["zip"],
		...overrides,
	}) satisfies RegisteredImportSource;

it("maps a registry file source onto the single-artifact upload token input", () => {
	expect(
		registryImportSourceFileInputs(registeredSource(), {
			source: "netflix",
			profileName: "Kids",
			uploadToken: " tok_netflix ",
		}),
	).toEqual([
		{
			required: undefined,
			payloadKey: undefined,
			artifactKey: undefined,
			bodyField: "uploadToken",
			allowedExtensions: ["zip"],
			uploadToken: "tok_netflix",
		},
	]);
});

it("maps a registry payload source onto no file inputs", () => {
	expect(
		registryImportSourceFileInputs(
			{
				name: "Trakt",
				slug: "trakt",
				input: "payload",
				pluginSlug: "media",
				requiredAppConfigKeys: [],
				description: "Trakt account",
				workflowSlug: "trakt-import",
			},
			{ source: "trakt", username: "alice" },
		),
	).toEqual([]);
});

it("maps named artifacts onto their existing token fields and stable path keys", () => {
	const source = {
		input: "file",
		lot: "named",
		name: "Movary",
		slug: "movary",
		pluginSlug: "media",
		requiredAppConfigKeys: [],
		description: "Movary export",
		workflowSlug: "movary-import",
		artifacts: [
			{
				required: true,
				key: "historyFilePath",
				allowedFileExtensions: ["csv"],
				uploadTokenField: "historyUploadToken",
			},
			{
				required: true,
				key: "ratingsFilePath",
				allowedFileExtensions: ["csv"],
				uploadTokenField: "ratingsUploadToken",
			},
		],
	} satisfies RegisteredImportSource;

	expect(
		registryImportSourceFileInputs(source, {
			source: "movary",
			ratingsUploadToken: "tok_ratings",
			historyUploadToken: " tok_history ",
			watchlistUploadToken: "tok_watchlist",
		}),
	).toEqual([
		{
			required: true,
			allowedExtensions: ["csv"],
			uploadToken: "tok_history",
			payloadKey: "historyFilePath",
			artifactKey: "historyFilePath",
			bodyField: "historyUploadToken",
		},
		{
			required: true,
			allowedExtensions: ["csv"],
			uploadToken: "tok_ratings",
			payloadKey: "ratingsFilePath",
			artifactKey: "ratingsFilePath",
			bodyField: "ratingsUploadToken",
		},
	]);
});

it("keeps omitted optional named artifact tokens unclaimed", () => {
	const source = {
		lot: "named",
		input: "file",
		slug: "myanimelist",
		name: "MyAnimeList",
		pluginSlug: "media",
		requiredAppConfigKeys: [],
		description: "MyAnimeList export",
		workflowSlug: "myanimelist-import",
		artifacts: [
			{
				required: false,
				key: "animeFilePath",
				allowedFileExtensions: ["gz", "xml"],
				uploadTokenField: "animeUploadToken",
			},
			{
				required: false,
				key: "mangaFilePath",
				allowedFileExtensions: ["gz", "xml"],
				uploadTokenField: "mangaUploadToken",
			},
		],
	} satisfies RegisteredImportSource;

	expect(
		registryImportSourceFileInputs(source, {
			source: "myanimelist",
			animeUploadToken: "tok_anime",
		}),
	).toEqual([
		{
			required: false,
			uploadToken: "tok_anime",
			payloadKey: "animeFilePath",
			artifactKey: "animeFilePath",
			bodyField: "animeUploadToken",
			allowedExtensions: ["gz", "xml"],
		},
		{
			required: false,
			uploadToken: undefined,
			payloadKey: "mangaFilePath",
			artifactKey: "mangaFilePath",
			bodyField: "mangaUploadToken",
			allowedExtensions: ["gz", "xml"],
		},
	]);
});

it.effect("reports every unconfigured app config key a registry source requires", () =>
	Effect.gen(function* () {
		const config = yield* AppConfig;

		expect(
			registryImportSourceStartError(
				registeredSource({
					requiredAppConfigKeys: ["moviesAndShows.tmdbAccessToken", "books.hardcoverApiKey"],
				}),
				config,
			),
		).toBe(
			"Netflix importer is not configured. Set moviesAndShows.tmdbAccessToken, books.hardcoverApiKey.",
		);
	}).pipe(Effect.provide(makeAppConfigLayer())),
);

it.effect("accepts a registry source whose required app config keys are all set", () =>
	Effect.gen(function* () {
		const config = yield* AppConfig;

		expect(
			registryImportSourceStartError(
				registeredSource({ requiredAppConfigKeys: ["moviesAndShows.tmdbAccessToken"] }),
				config,
			),
		).toBeUndefined();
	}).pipe(
		Effect.provide(
			makeAppConfigLayer({
				moviesAndShows: { tmdbAccessToken: Option.some(Redacted.make("tmdb-token")) },
			}),
		),
	),
);
