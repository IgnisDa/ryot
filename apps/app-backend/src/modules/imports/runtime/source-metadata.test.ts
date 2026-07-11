import { expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer } from "effect";

import type { RegisteredImportSource } from "#modules/plugins/import-source-catalog";

import {
	buildImportInputSummary,
	buildImportSourcePayload,
	registryImportSourceFileInputs,
	registryImportSourceInputError,
	registryImportSourceStartError,
} from "./source-metadata";

type SingleImportSource = Extract<RegisteredImportSource, { readonly lot: "single" }>;

const configSchema = {
	unknownKeys: "strict",
	fields: {
		tmdbAccessToken: {
			type: "string",
			label: "TMDB access token",
			description: "TMDB access token",
		},
		hardcoverApiKey: {
			type: "string",
			label: "Hardcover API key",
			description: "Hardcover API key",
		},
	},
} as const;

const registeredSource = (overrides: Partial<SingleImportSource> = {}) =>
	({
		lot: "single",
		input: "file",
		name: "Netflix",
		slug: "netflix",
		pluginSlug: "media",
		configSchema,
		requiredPluginConfigKeys: [],
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
				configSchema,
				requiredPluginConfigKeys: [],
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
		configSchema,
		requiredPluginConfigKeys: [],
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
		configSchema,
		requiredPluginConfigKeys: [],
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

it("rejects token fields not declared by the source without treating ordinary payload as tokens", () => {
	const source = registeredSource();
	const body = {
		source: "netflix",
		refreshToken: "payload-token",
		uploadToken: "declared-upload",
		historyUploadToken: "undeclared-upload",
	};

	expect(registryImportSourceInputError(source, body)).toBe(
		"Import source does not declare upload token field: historyUploadToken",
	);
});

it("rejects internal integration dispatch fields from public import payloads", () => {
	const body = {
		source: "netflix",
		uploadToken: "declared-upload",
		integrationScriptSlug: "integration.spoofed",
	};

	expect(registryImportSourceInputError(registeredSource(), body)).toBe(
		"Import source payload field is reserved: integrationScriptSlug",
	);
});

it("rejects manifest artifact path keys supplied without their upload tokens", () => {
	const source = {
		lot: "named",
		input: "file",
		slug: "fixture",
		name: "Fixture",
		pluginSlug: "fixture",
		configSchema,
		requiredPluginConfigKeys: [],
		description: "Fixture export",
		workflowSlug: "fixture-import",
		artifacts: [
			{
				required: false,
				key: "archiveFilePath",
				allowedFileExtensions: ["csv"],
				uploadTokenField: "archiveUploadToken",
			},
		],
	} satisfies RegisteredImportSource;

	expect(
		registryImportSourceInputError(source, {
			source: "fixture",
			archiveFilePath: "/tmp/unclaimed.csv",
		}),
	).toBe("Import source payload field is reserved: archiveFilePath");
});

it("filters declared artifact tokens while preserving JSON-compatible payload fields", () => {
	const source = registeredSource();
	const body = {
		enabled: false,
		source: "netflix",
		refreshToken: "payload-token",
		uploadToken: "declared-upload",
		options: { lists: ["favorites"], limit: 5 },
	};

	expect(buildImportSourcePayload(body, source)).toEqual({
		enabled: false,
		refreshToken: "payload-token",
		options: { lists: ["favorites"], limit: 5 },
	});
});

it("reports a missing required artifact before any artifact processing starts", () => {
	expect(registryImportSourceInputError(registeredSource(), { source: "netflix" })).toBe(
		"Import source requires an upload token",
	);
});

it("summarizes single-file input without exposing source-specific payload fields", () => {
	expect(
		buildImportInputSummary(
			{ source: "netflix", profileName: "Kids", uploadToken: "tok_netflix" },
			registeredSource(),
		),
	).toEqual({ source: "netflix", hasFile: true });
});

it("summarizes named artifacts from manifest declarations", () => {
	const source = {
		lot: "named",
		configSchema,
		input: "file",
		slug: "fixture",
		name: "Fixture",
		pluginSlug: "fixture",
		requiredPluginConfigKeys: [],
		description: "Fixture export",
		workflowSlug: "fixture-import",
		artifacts: [
			{
				required: false,
				key: "historyFilePath",
				allowedFileExtensions: ["json"],
				uploadTokenField: "historyUploadToken",
			},
		],
	} satisfies RegisteredImportSource;

	expect(buildImportInputSummary({ source: "fixture" }, source)).toEqual({
		source: "fixture",
		hasHistoryFile: false,
	});
});

it.effect("reports every unconfigured plugin config key a registry source requires", () =>
	Effect.gen(function* () {
		expect(
			yield* registryImportSourceStartError(
				registeredSource({ requiredPluginConfigKeys: ["tmdbAccessToken", "hardcoverApiKey"] }),
			),
		).toBe(
			"Netflix importer is not configured. Set RYOT_PLUGIN_MEDIA_TMDB_ACCESS_TOKEN, RYOT_PLUGIN_MEDIA_HARDCOVER_API_KEY.",
		);
	}).pipe(Effect.provide(Layer.setConfigProvider(ConfigProvider.fromMap(new Map())))),
);

it.effect("accepts a registry source whose required plugin config keys are all set", () =>
	Effect.gen(function* () {
		expect(
			yield* registryImportSourceStartError(
				registeredSource({ requiredPluginConfigKeys: ["tmdbAccessToken"] }),
			),
		).toBeUndefined();
	}).pipe(
		Effect.provide(
			Layer.setConfigProvider(
				ConfigProvider.fromMap(new Map([["RYOT_PLUGIN_MEDIA_TMDB_ACCESS_TOKEN", "tmdb-token"]])),
			),
		),
	),
);
