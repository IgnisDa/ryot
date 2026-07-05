import { PluginManifest } from "@ryot/plugin-kit/manifest";
import { sortBy } from "@ryot/ts-utils/lodash";
import { Schema } from "effect";
import { expect, it } from "vitest";

import { mediaPlugin } from "./manifest";

it("catalogs every sandbox script exactly once", async () => {
	const sandboxEntries = await Array.fromAsync(
		new Bun.Glob("scripts/**/*.sandbox.ts").scan({ cwd: process.cwd() }),
	);
	const catalogEntries = mediaPlugin.scripts.map(({ entry }) => entry);

	expect(sortBy(catalogEntries)).toEqual(sortBy(sandboxEntries));
	expect(new Set(catalogEntries).size).toBe(catalogEntries.length);
});

it("declares the complete media-owned source", () => {
	expect(() => Schema.decodeUnknownSync(PluginManifest)(mediaPlugin)).not.toThrow();
	expect(mediaPlugin.entitySchemas.map(({ slug }) => slug)).toContain("library");
	expect(mediaPlugin.relationshipSchemas.map(({ slug }) => slug)).toContain("in-library");
	expect(mediaPlugin.providers).toHaveLength(51);
	expect(mediaPlugin.scripts).toHaveLength(143);
	expect(mediaPlugin.scripts.every((script) => !("providerInformation" in script))).toBe(true);
	expect(
		mediaPlugin.scripts.filter(({ slug }) => slug.startsWith("activity.media-import-resolve.")),
	).toHaveLength(5);
	expect(
		mediaPlugin.scripts
			.filter(({ slug }) => slug.startsWith("activity.media-import-resolve."))
			.every(({ kind }) => kind === "activity"),
	).toBe(true);
	expect(mediaPlugin.scripts.filter(({ slug }) => slug.endsWith(".tmdb.trending"))).toEqual([
		expect.objectContaining({
			kind: "script",
			slug: "movie.tmdb.trending",
			providerSlug: "movie.tmdb",
		}),
		expect.objectContaining({
			kind: "script",
			slug: "show.tmdb.trending",
			providerSlug: "show.tmdb",
		}),
	]);
	expect(
		mediaPlugin.providers
			.filter(({ slug }) => slug === "movie.tmdb" || slug === "show.tmdb")
			.every(({ operations }) => !("trending" in operations)),
	).toBe(true);
	expect(mediaPlugin.operations).toEqual([
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
	expect(mediaPlugin.crons).toEqual([
		{
			schedule: "0 0 * * *",
			slug: "media-trending",
			scriptSlug: "media-trending",
			description: "Refresh global media trending rankings daily",
		},
	]);
	expect(mediaPlugin.savedViews.every(({ pluginSlug }) => pluginSlug === "media")).toBe(true);
});
