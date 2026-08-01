import { BunFileSystem } from "@effect/platform-bun";
import { assert, expect, it } from "@effect/vitest";
import { AuthoredPluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Effect, FileSystem, Schema } from "effect";

import {
	mediaLibraryEligibleEntitySchemaSlugs,
	mediaLibraryMemberEntitySchemaSlugs,
} from "../backend/contracts/schema-slugs";
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
			"anime-row": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/anime-row-presentation.ts",
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
			"anime-card": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/anime-card-presentation.ts",
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
			"audiobook-row": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/audiobook-row-presentation.ts",
			},
			"audiobook-card": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/audiobook-card-presentation.ts",
			},
			"comic-book-row": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/comic-book-row-presentation.ts",
			},
			"video-game-row": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/video-game-row-presentation.ts",
			},
			"book-group-row": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/book-group-row-presentation.ts",
			},
			"comic-book-card": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/comic-book-card-presentation.ts",
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
			"movie-group-row": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/movie-group-row-presentation.ts",
			},
			"book-group-card": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/book-group-card-presentation.ts",
			},
			"music-group-row": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/music-group-row-presentation.ts",
			},
			"visual-novel-row": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/visual-novel-row-presentation.ts",
			},
			"movie-group-card": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/movie-group-card-presentation.ts",
			},
			"music-group-card": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/music-group-card-presentation.ts",
			},
			"visual-novel-card": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/visual-novel-card-presentation.ts",
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
			"audiobook-group-row": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/audiobook-group-row-presentation.ts",
			},
			"anime-detail": {
				kind: "page",
				settingsSchema: { fields: {} },
				entry: "client/anime/screen.tsx",
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
			"audiobook-group-card": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/audiobook-group-card-presentation.ts",
			},
			"comic-book-group-row": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/comic-book-group-row-presentation.ts",
			},
			"video-game-group-row": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/video-game-group-row-presentation.ts",
			},
			"person-detail": {
				kind: "page",
				settingsSchema: { fields: {} },
				entry: "client/person/screen.tsx",
				automaticEntityPresentations: false,
			},
			"comic-book-group-card": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/comic-book-group-card-presentation.ts",
			},
			"video-game-group-card": {
				kind: "presentation",
				automaticEntityPresentations: false,
				entry: "client/video-game-group-card-presentation.ts",
			},
			"podcast-detail": {
				kind: "page",
				settingsSchema: { fields: {} },
				entry: "client/podcast/screen.tsx",
				automaticEntityPresentations: false,
			},
			"company-detail": {
				kind: "page",
				settingsSchema: { fields: {} },
				entry: "client/company/screen.tsx",
				automaticEntityPresentations: false,
			},
			"audiobook-detail": {
				kind: "page",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
				entry: "client/audiobook/screen.tsx",
			},
			"comic-book-detail": {
				kind: "page",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
				entry: "client/comic-book/screen.tsx",
			},
			"video-game-detail": {
				kind: "page",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
				entry: "client/video-game/screen.tsx",
			},
			"book-group-detail": {
				kind: "page",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
				entry: "client/book-group/screen.tsx",
			},
			"movie-group-detail": {
				kind: "page",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
				entry: "client/movie-group/screen.tsx",
			},
			"music-group-detail": {
				kind: "page",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
				entry: "client/music-group/screen.tsx",
			},
			"visual-novel-detail": {
				kind: "page",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
				entry: "client/visual-novel/screen.tsx",
			},
			"audiobook-group-detail": {
				kind: "page",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
				entry: "client/audiobook-group/screen.tsx",
			},
			"comic-book-group-detail": {
				kind: "page",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
				entry: "client/comic-book-group/screen.tsx",
			},
			"video-game-group-detail": {
				kind: "page",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
				entry: "client/video-game-group/screen.tsx",
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
		anime: {
			detailPage: "anime-detail",
			listPresentation: "anime-row",
			gridPresentation: "anime-card",
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
		person: {
			detailPage: "person-detail",
			listPresentation: "media-row",
			gridPresentation: "media-card",
		},
		company: {
			detailPage: "company-detail",
			listPresentation: "media-row",
			gridPresentation: "media-card",
		},
		podcast: {
			detailPage: "podcast-detail",
			listPresentation: "podcast-row",
			gridPresentation: "podcast-card",
		},
		audiobook: {
			detailPage: "audiobook-detail",
			listPresentation: "audiobook-row",
			gridPresentation: "audiobook-card",
		},
		"comic-book": {
			detailPage: "comic-book-detail",
			listPresentation: "comic-book-row",
			gridPresentation: "comic-book-card",
		},
		"video-game": {
			detailPage: "video-game-detail",
			listPresentation: "video-game-row",
			gridPresentation: "video-game-card",
		},
		"book-group": {
			detailPage: "book-group-detail",
			listPresentation: "book-group-row",
			gridPresentation: "book-group-card",
		},
		"movie-group": {
			detailPage: "movie-group-detail",
			listPresentation: "movie-group-row",
			gridPresentation: "movie-group-card",
		},
		"music-group": {
			detailPage: "music-group-detail",
			listPresentation: "music-group-row",
			gridPresentation: "music-group-card",
		},
		"visual-novel": {
			detailPage: "visual-novel-detail",
			listPresentation: "visual-novel-row",
			gridPresentation: "visual-novel-card",
		},
		"audiobook-group": {
			detailPage: "audiobook-group-detail",
			listPresentation: "audiobook-group-row",
			gridPresentation: "audiobook-group-card",
		},
		"comic-book-group": {
			detailPage: "comic-book-group-detail",
			listPresentation: "comic-book-group-row",
			gridPresentation: "comic-book-group-card",
		},
		"video-game-group": {
			detailPage: "video-game-group-detail",
			listPresentation: "video-game-group-row",
			gridPresentation: "video-game-group-card",
		},
	};
	for (const [slug, registration] of Object.entries(registrations)) {
		expect(registration).toEqual(
			dedicatedRenderers[slug] ?? { listPresentation: "media-row", gridPresentation: "media-card" },
		);
	}
	expect(mediaPlugin.entitySchemas.map(({ slug }) => slug)).toContain("media-library");
	expect(mediaPlugin.relationshipSchemas.map(({ slug }) => slug)).toContain("in-media-library");
	expect(mediaPlugin.entitySchemas.find(({ slug }) => slug === "media-library")).toEqual(
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
			demoAccess: "allowed",
			slug: "media-monitoring-status",
			description: "Read media monitoring status",
			scriptSlug: "operation.media-monitoring-status",
		},
		{
			auth: "user",
			demoAccess: "protected",
			slug: "media-monitoring-enable",
			description: "Enable media monitoring",
			scriptSlug: "operation.media-monitoring-enable",
		},
		{
			auth: "user",
			demoAccess: "protected",
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
			demoAccess: "allowed",
			slug: "resolve-episodes",
			scriptSlug: "operation.resolve-episodes",
			description: "Resolve show and podcast episode references to entity ids",
		},
	]);
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

it("uses one required library hook for eligible creates, provider completion, and library-joining events", () => {
	const hooks = mediaPlugin.hooks.filter(
		({ slug }) => slug === "media.ensure-media-library-membership",
	);
	expect(hooks).toHaveLength(1);
	expect(hooks[0]).toEqual({
		stage: "after",
		delivery: "required",
		executionScope: "user",
		name: "Ensure media library membership",
		slug: "media.ensure-media-library-membership",
		scriptSlug: "automation.ensure-media-library-membership",
		targets: [
			...mediaLibraryMemberEntitySchemaSlugs.flatMap((entitySchemaSlug) => [
				{ entitySchemaSlug, resource: "entity", operation: "create" },
				{ entitySchemaSlug, operation: "complete", resource: "provider-entity-import" },
			]),
			...mediaPlugin.entitySchemas.flatMap((schema) =>
				schema.eventSchemas
					.filter(({ slug }) => slug !== "add-to-media-library")
					.map(({ slug }) => ({
						resource: "event",
						operation: "create",
						eventSchemaSlug: slug,
						entitySchemaSlug: schema.slug,
					})),
			),
			{
				resource: "event",
				operation: "create",
				entitySchemaSlug: "collection",
				eventSchemaSlug: "add-entity-to-collection",
			},
		],
	});
});

it("records newly-created media library memberships as events", () => {
	const hooks = mediaPlugin.hooks.filter(
		({ slug }) => slug === "media.record-media-library-membership-event",
	);

	expect(hooks).toEqual([
		{
			stage: "after",
			delivery: "required",
			executionScope: "user",
			name: "Record media library membership event",
			slug: "media.record-media-library-membership-event",
			scriptSlug: "automation.record-media-library-membership-event",
			targets: [
				{
					operation: "create",
					resource: "relationship",
					relationshipSchemaSlug: "in-media-library",
				},
			],
		},
	]);
});

it("binds deterministic episodic sessions at policy position 200", () => {
	const hooks = mediaPlugin.hooks.filter(
		({ scriptSlug }) => scriptSlug === "policy.media-episodic-session",
	);

	expect(hooks).toHaveLength(1);
	expect(hooks[0]).toMatchObject({
		position: 200,
		stage: "before",
		slug: "media.episodic-session",
	});
	expect(
		hooks
			.flatMap(({ targets }) =>
				targets.flatMap((target) =>
					target.resource === "event"
						? [`${target.entitySchemaSlug}:${target.eventSchemaSlug}`]
						: [],
				),
			)
			.sort(),
	).toEqual(
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

it("binds episodic parent completion to child completions and per-user status changes", () => {
	expect(
		mediaPlugin.hooks.filter(
			({ scriptSlug }) => scriptSlug === "automation.media-auto-complete-episodic-parent",
		),
	).toEqual([
		{
			stage: "after",
			delivery: "required",
			executionScope: "user",
			name: "Complete episodic parent",
			slug: "media.auto-complete-episodic-parent",
			scriptSlug: "automation.media-auto-complete-episodic-parent",
			targets: [
				{
					resource: "event",
					operation: "create",
					eventSchemaSlug: "complete",
					entitySchemaSlug: "show-episode",
				},
				{
					resource: "event",
					operation: "create",
					eventSchemaSlug: "complete",
					entitySchemaSlug: "podcast-episode",
				},
			],
		},
		{
			stage: "after",
			delivery: "async",
			executionScope: "user",
			slug: "media.auto-complete-on-status-change",
			name: "Complete episodic parent on status change",
			scriptSlug: "automation.media-auto-complete-episodic-parent",
			targets: [
				{ operation: "emit", resource: "signal", signalSchemaSlug: "media.status.changed" },
			],
		},
	]);
});

it("does not automatically retry external pushes or notifications", () => {
	const hooks = mediaPlugin.hooks.filter(({ slug }) =>
		[
			"media.radarr-push",
			"media.sonarr-push",
			"media.jellyfin-push",
			"media.notification",
		].includes(slug),
	);
	expect(hooks).toHaveLength(4);
	for (const hook of hooks) {
		expect(hook).toMatchObject({
			stage: "after",
			delivery: "async",
			retry: { maxAttempts: 1, externalIdempotency: "none" },
		});
	}
});
