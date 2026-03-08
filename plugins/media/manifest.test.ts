import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { PluginManifest } from "@ryot/plugin-kit/manifest";
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
	expect(mediaPlugin.providers).toHaveLength(51);
	expect(mediaPlugin.scripts).toHaveLength(179);
	expect(mediaPlugin.integrationProviders).toHaveLength(13);
	expect(mediaPlugin.scripts.every((script) => !("providerInformation" in script))).toBe(true);
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
			slug: "media-monitoring-targets",
			capabilities: ["executeQueryEngine"],
		}),
	);
	expect(mediaPlugin.savedViews.every(({ pluginSlug }) => pluginSlug === "media")).toBe(true);
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
