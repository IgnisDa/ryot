import { BunFileSystem } from "@effect/platform-bun";
import { assert, expect, it } from "@effect/vitest";
import { AuthoredPluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Effect, FileSystem, Schema } from "effect";

import { mediaLibraryEligibleEntitySchemaSlugs } from "../backend/contracts/schema-slugs";
import { manifest as googleBooksSearchManifest } from "../backend/providers/book/google-books/search.sandbox";
import { manifest as igdbSearchOptionsManifest } from "../backend/providers/video-game/igdb/search-options.sandbox";
import { manifest as igdbSearchManifest } from "../backend/providers/video-game/igdb/search.sandbox";
import { manifest as monitoringTargetsManifest } from "../backend/workflows/media-monitoring-targets.sandbox";
import { mediaPlugin } from "./plugin";
import { mediaSavedViews } from "./saved-views";

const PROVIDER_OPERATIONS = new Set([
	"details",
	"resolve",
	"search",
	"search-options",
	"translate",
]);

it.effect("backs every declared provider operation with its entry file", () =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const entries = yield* fs.glob("backend/providers/**/*.sandbox.ts", { root: process.cwd() });
		const operationsByProvider = new Map<string, string[]>();
		for (const entry of entries) {
			const segments = entry.slice("backend/providers/".length).split("/");
			const file = segments.at(-1);
			assert(file && segments.length > 1);
			const providerSlug = segments.slice(0, -1).join(".");
			operationsByProvider.set(providerSlug, [
				...(operationsByProvider.get(providerSlug) ?? []),
				file.replace(".sandbox.ts", ""),
			]);
		}

		expect(sortBy([...operationsByProvider.keys()])).toEqual(
			sortBy(mediaPlugin.providers.map(({ slug }) => slug)),
		);
		const associatedScripts: string[] = [];
		for (const provider of mediaPlugin.providers) {
			const files = operationsByProvider.get(provider.slug) ?? [];
			const declared = Object.keys(provider.operations).map((operation) =>
				operation === "searchOptions" ? "search-options" : operation,
			);
			expect(sortBy(files.filter((file) => PROVIDER_OPERATIONS.has(file)))).toEqual(
				sortBy(declared),
			);
			associatedScripts.push(
				...files
					.filter((file) => !PROVIDER_OPERATIONS.has(file))
					.map((file) => `${provider.slug}.${file}`),
			);
		}
		expect(sortBy(associatedScripts)).toEqual([
			"movie.tmdb.trending",
			"music.youtube-music.history",
			"show.tmdb.trending",
		]);
	}).pipe(Effect.provide(BunFileSystem.layer)),
);

it("declares the complete media-owned source", () => {
	expect(() => Schema.decodeUnknownSync(AuthoredPluginManifest)(mediaPlugin)).not.toThrow();
	expect(mediaPlugin.client).toEqual({
		apiVersion: 1,
		homeView: null,
		entities: expect.any(Object),
		routes: { "/": "media-home" },
		exports: {
			"show-progress": {
				kind: "component",
				entry: "client/show/progress.tsx",
				automaticEntityPresentations: false,
			},
			"show-row": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/show-row-presentation.ts",
			},
			"book-row": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/book-row-presentation.ts",
			},
			"manga-row": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/manga-row-presentation.ts",
			},
			"show-card": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/show-card-presentation.ts",
			},
			"media-row": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/media-row-presentation.ts",
			},
			"movie-row": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/movie-row-presentation.ts",
			},
			"music-row": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/music-row-presentation.ts",
			},
			"book-card": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/book-card-presentation.ts",
			},
			"manga-card": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/manga-card-presentation.ts",
			},
			"media-card": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/media-card-presentation.ts",
			},
			"movie-card": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/movie-card-presentation.ts",
			},
			"music-card": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/music-card-presentation.ts",
			},
			"podcast-row": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/podcast-row-presentation.ts",
			},
			"podcast-card": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/podcast-card-presentation.ts",
			},
			"video-game-row": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/video-game-row-presentation.ts",
			},
			"media-home": {
				kind: "page",
				entry: "client/home.tsx",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
			},
			"video-game-card": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/video-game-card-presentation.ts",
			},
			"show-detail": {
				kind: "page",
				settingsSchema: { fields: {} },
				entry: "client/show/screen.tsx",
				automaticEntityPresentations: false,
			},
			"book-detail": {
				kind: "page",
				settingsSchema: { fields: {} },
				entry: "client/book/screen.tsx",
				automaticEntityPresentations: false,
			},
			"manga-detail": {
				kind: "page",
				settingsSchema: { fields: {} },
				entry: "client/manga/screen.tsx",
				automaticEntityPresentations: false,
			},
			"movie-detail": {
				kind: "page",
				settingsSchema: { fields: {} },
				entry: "client/movie/screen.tsx",
				automaticEntityPresentations: false,
			},
			"music-detail": {
				kind: "page",
				settingsSchema: { fields: {} },
				entry: "client/music/screen.tsx",
				automaticEntityPresentations: false,
			},
			"podcast-detail": {
				kind: "page",
				settingsSchema: { fields: {} },
				entry: "client/podcast/screen.tsx",
				automaticEntityPresentations: false,
			},
			"video-game-detail": {
				kind: "page",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
				entry: "client/video-game/screen.tsx",
			},
		},
	});
	const registrations = mediaPlugin.client.entities;
	expect(Object.keys(registrations)).toHaveLength(mediaSavedViews().length);
	const dedicatedRenderers: Record<string, unknown> = {
		show: {
			detailPage: "show-detail",
			listPresentation: "show-row",
			gridPresentation: "show-card",
		},
		book: {
			detailPage: "book-detail",
			listPresentation: "book-row",
			gridPresentation: "book-card",
		},
		manga: {
			detailPage: "manga-detail",
			listPresentation: "manga-row",
			gridPresentation: "manga-card",
		},
		movie: {
			detailPage: "movie-detail",
			listPresentation: "movie-row",
			gridPresentation: "movie-card",
		},
		music: {
			detailPage: "music-detail",
			listPresentation: "music-row",
			gridPresentation: "music-card",
		},
		podcast: {
			detailPage: "podcast-detail",
			listPresentation: "podcast-row",
			gridPresentation: "podcast-card",
		},
		"video-game": {
			detailPage: "video-game-detail",
			listPresentation: "video-game-row",
			gridPresentation: "video-game-card",
		},
	};
	for (const [slug, registration] of Object.entries(registrations)) {
		expect(registration).toEqual(
			dedicatedRenderers[slug] ?? { listPresentation: "media-row", gridPresentation: "media-card" },
		);
	}
	expect(mediaPlugin.entitySchemas.map(({ slug }) => slug)).toContain("library");
	expect(mediaPlugin.relationshipSchemas.map(({ slug }) => slug)).toContain("in-library");
	expect(mediaPlugin.entitySchemas.find(({ slug }) => slug === "library")).toEqual(
		expect.objectContaining({ userState: { deniedOperations: ["clear", "merge"] } }),
	);
	expect(mediaPlugin.configSchema.unknownKeys).toBe("strict");
	expect(Object.keys(mediaPlugin.configSchema.fields)).toEqual([
		"metronUsername",
		"twitchClientId",
		"traktClientId",
		"spotifyClientId",
		"tvdbApiKey",
		"malClientId",
		"metronPassword",
		"tmdbAccessToken",
		"hardcoverApiKey",
		"giantBombApiKey",
		"twitchClientSecret",
		"googleBooksApiKey",
		"listennotesApiKey",
		"spotifyClientSecret",
		"progressUpdateThresholdHours",
	]);
	expect(mediaPlugin.configSchema.fields.tmdbAccessToken?.secret).toBe(true);
	expect(mediaPlugin.configSchema.fields.progressUpdateThresholdHours?.defaultValue).toBe(2);
	expect(mediaPlugin.httpRateLimits).toEqual([
		{ requests: 90, key: "anilist", intervalMs: 60_000, origins: ["https://graphql.anilist.co"] },
		{ requests: 1, intervalMs: 1_000, key: "musicbrainz", origins: ["https://musicbrainz.org"] },
	]);
	expect(mediaPlugin.httpRateLimits.flatMap(({ origins }) => origins)).not.toContain(
		"https://coverartarchive.org",
	);
	expect(mediaPlugin.providers).toHaveLength(51);
	expect(mediaPlugin.integrationProviders).toHaveLength(12);
	expect(googleBooksSearchManifest).toMatchObject({
		searchOptionsSchema: { unknownKeys: "strict" },
	});
	expect(igdbSearchManifest).toMatchObject({
		searchOptionsSchema: {
			unknownKeys: "strict",
			fields: {
				themeIds: { type: "enum-array", choices: { kind: "dynamic", source: "themes" } },
				genreIds: { type: "enum-array", choices: { kind: "dynamic", source: "genres" } },
				platformIds: { type: "enum-array", choices: { kind: "dynamic", source: "platforms" } },
				gameModeIds: { type: "enum-array", choices: { kind: "dynamic", source: "gameModes" } },
				gameTypeIds: { type: "enum-array", choices: { kind: "dynamic", source: "gameTypes" } },
				releaseDateRegionIds: {
					type: "enum-array",
					choices: { kind: "dynamic", source: "releaseDateRegions" },
				},
			},
		},
	});
	expect(mediaPlugin.providers.find(({ slug }) => slug === "video-game.igdb")).toMatchObject({
		operations: { searchOptions: "video-game.igdb.search-options" },
	});
	expect(igdbSearchOptionsManifest).toMatchObject({
		kind: "provider",
		slug: "video-game.igdb.search-options",
	});
	expect(
		mediaPlugin.providers
			.filter(({ slug }) => slug === "movie.tmdb" || slug === "show.tmdb")
			.every(({ operations }) => !("trending" in operations)),
	).toBe(true);
	expect(mediaPlugin.operations).toEqual([
		{
			auth: "user",
			slug: "media-monitoring-status",
			description: "Read media monitoring status",
			scriptSlug: "operation.media-monitoring-status",
		},
		{
			auth: "user",
			slug: "media-monitoring-enable",
			description: "Enable media monitoring",
			scriptSlug: "operation.media-monitoring-enable",
		},
		{
			auth: "user",
			slug: "media-monitoring-disable",
			description: "Disable media monitoring",
			scriptSlug: "operation.media-monitoring-disable",
		},
		{
			auth: "integration",
			slug: "metadata-lookup",
			scriptSlug: "operation.metadata-lookup",
			description: "Match browser extension titles to TMDB movies and shows",
		},
		{
			auth: "user",
			slug: "resolve-episodes",
			scriptSlug: "operation.resolve-episodes",
			description: "Resolve show and podcast episode references to entity ids",
		},
	]);
	expect(mediaPlugin.boot).toEqual([]);
	expect(mediaPlugin.userBootstrap).toEqual([
		{
			slug: "initialize-workspace",
			scriptSlug: "bootstrap.media-workspace",
			description: "Initialize the user's media workspace",
		},
	]);
	expect(mediaPlugin.importSources.map(({ slug }) => slug)).toEqual([
		"netflix",
		"goodreads",
		"storygraph",
		"hardcover",
		"anilist",
		"trakt",
		"imdb",
		"igdb",
		"grouvee",
		"watcharr",
		"movary",
		"myanimelist",
		"jellyfin",
		"plex",
		"audiobookshelf",
		"media_tracker",
	]);
	expect(mediaPlugin.crons).toEqual([
		{
			slug: "media-monitoring",
			schedule: { tier: "infrequent" },
			scriptSlug: "workflow.media-monitoring-sweep",
			description: "Refresh monitored provider-backed media",
		},
		{
			slug: "media-trending",
			scriptSlug: "media-trending",
			schedule: { tier: "infrequent" },
			description: "Refresh global media trending rankings",
		},
	]);
	expect(mediaPlugin.workflows).toContainEqual({
		slug: "media-monitoring-sweep",
		scriptSlug: "workflow.media-monitoring-sweep",
	});
	expect(monitoringTargetsManifest).toMatchObject({
		kind: "script",
		capabilities: ["executeRyotql"],
		slug: "media-monitoring-targets",
	});
	expect(mediaPlugin.savedViews.every(({ pluginSlug }) => pluginSlug === "media")).toBe(true);
	expect(
		mediaPlugin.savedViews.map(({ name, settings }) => ({
			name,
			entitySchemaSlug: (settings["addAction"] as { readonly entitySchemaSlug: string })
				.entitySchemaSlug,
		})),
	).toEqual([
		{ name: "All Persons", entitySchemaSlug: "person" },
		{ name: "All Companies", entitySchemaSlug: "company" },
		{ name: "All Shows", entitySchemaSlug: "show" },
		{ name: "All Books", entitySchemaSlug: "book" },
		{ name: "All Movies", entitySchemaSlug: "movie" },
		{ name: "All Music", entitySchemaSlug: "music" },
		{ name: "All Manga", entitySchemaSlug: "manga" },
		{ name: "All Anime", entitySchemaSlug: "anime" },
		{ name: "All Podcasts", entitySchemaSlug: "podcast" },
		{ name: "All Audiobooks", entitySchemaSlug: "audiobook" },
		{ name: "All Video Games", entitySchemaSlug: "video-game" },
		{ name: "All Comic Books", entitySchemaSlug: "comic-book" },
		{ name: "All Book Series", entitySchemaSlug: "book-group" },
		{ name: "All Movie Series", entitySchemaSlug: "movie-group" },
		{ name: "All Music Albums", entitySchemaSlug: "music-group" },
		{ name: "All Visual Novels", entitySchemaSlug: "visual-novel" },
		{ name: "All Audiobook Series", entitySchemaSlug: "audiobook-group" },
		{ name: "All Comic Book Series", entitySchemaSlug: "comic-book-group" },
		{ name: "All Video Game Franchises", entitySchemaSlug: "video-game-group" },
	]);
	expect(mediaPlugin.providers.find(({ slug }) => slug === "book.google-books")).toEqual(
		expect.objectContaining({ rootEntitySchemaSlug: "book" }),
	);
	expect(mediaPlugin.entitySchemas.map(({ slug }) => slug).sort()).toEqual(
		[...mediaLibraryEligibleEntitySchemaSlugs].sort(),
	);
});

it("binds library membership to media events and collection membership", () => {
	const bindings = mediaPlugin.bindings.eventAutomations.filter(
		({ scriptSlug }) => scriptSlug === "policy.media-library-membership",
	);
	const mediaEventSchemaSlugs = mediaPlugin.entitySchemas.flatMap((schema) =>
		schema.eventSchemas.map(({ slug }) => `${schema.slug}:${slug}`),
	);

	expect(bindings.map(({ eventSchemaSlug }) => eventSchemaSlug).sort()).toEqual(
		["collection:add-entity-to-collection", ...mediaEventSchemaSlugs].sort(),
	);
	expect(bindings).toContainEqual(
		expect.objectContaining({ eventSchemaSlug: "collection:add-entity-to-collection" }),
	);
	expect(bindings).not.toContainEqual(
		expect.objectContaining({ eventSchemaSlug: "workout:workout" }),
	);
	expect(bindings).not.toContainEqual(
		expect.objectContaining({ eventSchemaSlug: "fixture:event" }),
	);
});

it("binds provider imports to library membership for every eligible schema", () => {
	expect(mediaPlugin.bindings.providerEntityImportAutomations).toEqual(
		mediaLibraryEligibleEntitySchemaSlugs.map((entitySchemaSlug) => ({
			entitySchemaSlug,
			scriptSlug: "automation.media-library-membership-on-import",
		})),
	);
});

it("binds deterministic episodic sessions at policy position 200", () => {
	const bindings = mediaPlugin.bindings.eventAutomations.filter(
		({ scriptSlug }) => scriptSlug === "policy.media-episodic-session",
	);

	expect(bindings).toHaveLength(12);
	expect(
		bindings.every(
			(binding) => binding.kind === "policy" && "position" in binding && binding.position === 200,
		),
	).toBe(true);
	expect(bindings.map(({ eventSchemaSlug }) => eventSchemaSlug).sort()).toEqual(
		[
			"show:backlog",
			"show:complete",
			"show:dropped",
			"show:on_hold",
			"show-episode:progress",
			"show-episode:complete",
			"podcast:backlog",
			"podcast:complete",
			"podcast:dropped",
			"podcast:on_hold",
			"podcast-episode:progress",
			"podcast-episode:complete",
		].sort(),
	);
});

it("binds episodic parent completion to child completions and parent updates", () => {
	expect(
		mediaPlugin.bindings.eventAutomations
			.filter(({ scriptSlug }) => scriptSlug === "automation.media-auto-complete-episodic-parent")
			.map(({ eventSchemaSlug }) => eventSchemaSlug)
			.sort(),
	).toEqual(["podcast-episode:complete", "show-episode:complete"]);
	expect(
		mediaPlugin.bindings.entityAutomations
			.filter(({ scriptSlug }) => scriptSlug === "automation.media-auto-complete-episodic-parent")
			.map(({ operation, entitySchemaSlug }) => ({ operation, entitySchemaSlug })),
	).toEqual([
		{ operation: "update", entitySchemaSlug: "show" },
		{ operation: "update", entitySchemaSlug: "podcast" },
	]);
});
