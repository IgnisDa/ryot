import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { PluginManifest } from "@ryot/contract/modules/plugins/manifest";
import { sortBy } from "@ryot/ts-utils/lodash";
import { Effect, FileSystem, Schema } from "effect";

import { mediaPlugin } from "./manifest";
import { mediaLibraryEligibleEntitySchemaSlugs } from "./schemas/media-schema-slugs";

it.effect("catalogs every sandbox script exactly once", () =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const sandboxEntries = yield* fs.glob("scripts/**/*.sandbox.ts", { root: process.cwd() });
		const catalogEntries = mediaPlugin.scripts.map(({ entry }) => entry);

		expect(sortBy(catalogEntries)).toEqual(sortBy(sandboxEntries));
		expect(new Set(catalogEntries).size).toBe(catalogEntries.length);
	}).pipe(Effect.provide(BunFileSystem.layer)),
);

it("routes person and company providers through provider scripts", () => {
	const providerSlugs = new Set(
		mediaPlugin.providers
			.filter(({ slug }) => slug.startsWith("person.") || slug.startsWith("company."))
			.map(({ slug }) => slug),
	);
	const providerScripts = mediaPlugin.scripts.flatMap((script) =>
		script.kind === "provider" && providerSlugs.has(script.providerSlug) ? [script] : [],
	);

	expect(new Set(providerScripts.map(({ providerSlug }) => providerSlug))).toEqual(providerSlugs);

	for (const provider of mediaPlugin.providers.filter(({ slug }) => providerSlugs.has(slug))) {
		expect(
			providerScripts
				.filter(({ providerSlug }) => providerSlug === provider.slug)
				.map(({ providerOperation }) => providerOperation)
				.sort(),
		).toEqual(Object.keys(provider.operations).sort());
	}
});

it("routes media-group providers through provider scripts", () => {
	const providerSlugs = new Set(
		mediaPlugin.providers.filter(({ slug }) => slug.includes("-group.")).map(({ slug }) => slug),
	);
	const providerScripts = mediaPlugin.scripts.flatMap((script) =>
		script.kind === "provider" && providerSlugs.has(script.providerSlug) ? [script] : [],
	);

	expect(providerScripts).toHaveLength(23);
	expect(new Set(providerScripts.map(({ providerSlug }) => providerSlug))).toEqual(providerSlugs);

	for (const provider of mediaPlugin.providers.filter(({ slug }) => providerSlugs.has(slug))) {
		expect(
			providerScripts
				.filter(({ providerSlug }) => providerSlug === provider.slug)
				.map(({ providerOperation }) => providerOperation)
				.sort(),
		).toEqual(Object.keys(provider.operations).sort());
	}
});

it("declares the complete media-owned source", () => {
	expect(() => Schema.decodeUnknownSync(PluginManifest)(mediaPlugin)).not.toThrow();
	expect(mediaPlugin.entitySchemas.map(({ slug }) => slug)).toContain("library");
	expect(mediaPlugin.relationshipSchemas.map(({ slug }) => slug)).toContain("in-library");
	expect(mediaPlugin.entitySchemas.find(({ slug }) => slug === "library")).toEqual(
		expect.objectContaining({ userState: { deniedOperations: ["clear", "merge"] } }),
	);
	expect(mediaPlugin.configSchema.unknownKeys).toBe("strict");
	expect(Object.keys(mediaPlugin.configSchema.fields)).toEqual([
		"tvdbApiKey",
		"tmdbAccessToken",
		"malClientId",
		"metronUsername",
		"metronPassword",
		"hardcoverApiKey",
		"googleBooksApiKey",
		"spotifyClientId",
		"spotifyClientSecret",
		"listennotesApiKey",
		"twitchClientId",
		"twitchClientSecret",
		"giantBombApiKey",
		"traktClientId",
		"progressUpdateThresholdHours",
	]);
	expect(mediaPlugin.configSchema.fields.tmdbAccessToken?.secret).toBe(true);
	expect(mediaPlugin.configSchema.fields.progressUpdateThresholdHours?.defaultValue).toBe(2);
	expect(mediaPlugin.httpRateLimits).toEqual([
		{
			requests: 90,
			key: "anilist",
			intervalMs: 60_000,
			origins: ["https://graphql.anilist.co"],
		},
		{
			requests: 1,
			intervalMs: 1_000,
			key: "musicbrainz",
			origins: ["https://musicbrainz.org"],
		},
	]);
	expect(mediaPlugin.httpRateLimits.flatMap(({ origins }) => origins)).not.toContain(
		"https://coverartarchive.org",
	);
	expect(mediaPlugin.providers).toHaveLength(51);
	expect(mediaPlugin.scripts).toHaveLength(182);
	expect(mediaPlugin.integrationProviders).toHaveLength(12);
	expect(mediaPlugin.scripts.every((script) => !("providerInformation" in script))).toBe(true);
	expect(mediaPlugin.scripts.find(({ slug }) => slug === "book.google-books.search")).toMatchObject(
		{ searchOptionsSchema: { unknownKeys: "strict" } },
	);
	expect(mediaPlugin.scripts.find(({ slug }) => slug === "video-game.igdb.search")).toMatchObject({
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
	expect(
		mediaPlugin.scripts.find(({ slug }) => slug === "video-game.igdb.search-options"),
	).toMatchObject({
		kind: "provider",
		providerSlug: "video-game.igdb",
		providerOperation: "search-options",
	});
	expect(
		mediaPlugin.scripts.filter(({ slug }) => slug.startsWith("media-import-resolve.")),
	).toHaveLength(5);
	expect(
		mediaPlugin.scripts
			.filter(({ slug }) => slug.startsWith("media-import-resolve."))
			.every(({ kind }) => kind === "script"),
	).toBe(true);
	expect(mediaPlugin.scripts.filter(({ slug }) => slug.endsWith(".tmdb.trending"))).toEqual([
		expect.objectContaining({
			kind: "script",
			providerSlug: "movie.tmdb",
			slug: "movie.tmdb.trending",
		}),
		expect.objectContaining({
			kind: "script",
			providerSlug: "show.tmdb",
			slug: "show.tmdb.trending",
		}),
	]);
	expect(
		mediaPlugin.scripts
			.filter(({ slug }) => slug.startsWith("integration."))
			.every(({ kind }) => kind === "script"),
	).toBe(true);
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
	expect(mediaPlugin.scripts).toContainEqual(
		expect.objectContaining({
			kind: "script",
			capabilities: ["executeRyotql"],
			slug: "media-monitoring-targets",
		}),
	);
	expect(mediaPlugin.savedViews.every(({ pluginSlug }) => pluginSlug === "media")).toBe(true);
	expect(
		mediaPlugin.savedViews.map(({ name, entitySchemaSlug }) => ({ name, entitySchemaSlug })),
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
		expect.objectContaining({
			eventSchemaSlug: "collection:add-entity-to-collection",
		}),
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
			.map(({ entitySchemaSlug, operation }) => ({ entitySchemaSlug, operation })),
	).toEqual([
		{ entitySchemaSlug: "show", operation: "update" },
		{ entitySchemaSlug: "podcast", operation: "update" },
	]);
});
