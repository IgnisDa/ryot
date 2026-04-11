import { expect, it } from "@effect/vitest";
import type { PluginManifest } from "@ryot/plugin-kit/manifest";
import { Effect, Layer } from "effect";

import { makeDefinitionRegistry } from "#modules/definition-registry/service";

import { ImportSourceCatalog } from "./import-source-catalog";
import { makePluginLoader, PluginLoader } from "./loader";
import { fixtureManifest } from "./test-support";
import type { NormalizedPlugin } from "./types";

const pluginWithImportSources = (
	slug: string,
	importSources: PluginManifest["importSources"],
): NormalizedPlugin => ({
	scripts: [],
	sourceHash: `source-${slug}`,
	manifest: {
		...fixtureManifest(),
		importSources,
		entitySchemas: [],
		signalSchemas: [],
		relationshipSchemas: [],
		metadata: { ...fixtureManifest().metadata, slug },
		bindings: { ...fixtureManifest().bindings, entityAutomations: [] },
	},
});

const catalogLayer = () => {
	const loader = makePluginLoader(makeDefinitionRegistry());
	loader.rebuild([
		pluginWithImportSources("zebra", [
			{
				lot: "single",
				input: "file",
				name: "OpenScale",
				slug: "open-scale",
				requiredAppConfigKeys: [],
				allowedFileExtensions: ["csv"],
				description: "OpenScale export",
				workflowSlug: "open-scale-import",
			},
		]),
		pluginWithImportSources("apple", [
			{
				lot: "single",
				input: "file",
				slug: "netflix",
				name: "Netflix",
				description: "Netflix export",
				workflowSlug: "netflix-import",
				allowedFileExtensions: ["zip"],
				requiredAppConfigKeys: ["moviesAndShows.tmdbAccessToken"],
			},
			{
				slug: "trakt",
				name: "Trakt",
				input: "payload",
				description: "Trakt account",
				workflowSlug: "trakt-import",
				requiredAppConfigKeys: ["server.traktClientId"],
			},
		]),
	]);
	return ImportSourceCatalog.Default.pipe(
		Layer.provide(Layer.succeed(PluginLoader, { _tag: "PluginLoader", ...loader })),
	);
};

it.effect("lists import sources from every plugin ordered by plugin slug then source slug", () =>
	Effect.gen(function* () {
		const catalog = yield* ImportSourceCatalog;

		expect(catalog.list().map(({ pluginSlug, slug }) => `${pluginSlug}/${slug}`)).toEqual([
			"apple/netflix",
			"apple/trakt",
			"zebra/open-scale",
		]);
	}).pipe(Effect.provide(catalogLayer())),
);

it.effect("resolves the owning plugin, workflow and input metadata by source slug", () =>
	Effect.gen(function* () {
		const catalog = yield* ImportSourceCatalog;

		expect(catalog.find("netflix")).toMatchObject({
			lot: "single",
			input: "file",
			pluginSlug: "apple",
			workflowSlug: "netflix-import",
			allowedFileExtensions: ["zip"],
			requiredAppConfigKeys: ["moviesAndShows.tmdbAccessToken"],
		});
		expect(catalog.find("trakt")).toMatchObject({ input: "payload", pluginSlug: "apple" });
		expect(catalog.find("goodreads")).toBeNull();
	}).pipe(Effect.provide(catalogLayer())),
);
