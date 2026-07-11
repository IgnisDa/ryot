import { expect, it } from "@effect/vitest";
import type { PluginManifest } from "@ryot/plugin-kit/manifest";
import { Effect, Layer } from "effect";

import { makeDefinitionRegistry } from "#modules/definition-registry/service";

import { IntegrationProviderCatalog } from "./integration-provider-catalog";
import { makePluginLoader, PluginLoader } from "./loader";
import { fixtureManifest } from "./test-support";
import type { NormalizedPlugin } from "./types";

const settingsSchema = {
	fields: { token: { type: "string", label: "Token", description: "API token", secret: true } },
} satisfies PluginManifest["integrationProviders"][number]["settingsSchema"];

const pluginWithProviders = (
	slug: string,
	integrationProviders: PluginManifest["integrationProviders"],
): NormalizedPlugin => ({
	scripts: [],
	sourceHash: `source-${slug}`,
	manifest: {
		...fixtureManifest(),
		entitySchemas: [],
		signalSchemas: [],
		integrationProviders,
		relationshipSchemas: [],
		metadata: { ...fixtureManifest().metadata, slug },
		bindings: { ...fixtureManifest().bindings, entityAutomations: [] },
	},
});

const catalogLayer = () => {
	const loader = makePluginLoader(makeDefinitionRegistry());
	loader.rebuild([
		pluginWithProviders("zebra", [
			{ settingsSchema, slug: "radarr", lot: "push", name: "Radarr", description: "Radarr push" },
		]),
		pluginWithProviders("apple", [
			{
				lot: "sink",
				name: "Plex",
				slug: "plex",
				settingsSchema,
				description: "Plex sink",
				scriptSlug: "fixture.automation",
			},
			{
				lot: "yank",
				slug: "komga",
				name: "Komga",
				settingsSchema,
				description: "Komga yank",
				scriptSlug: "fixture.automation",
			},
		]),
	]);
	return IntegrationProviderCatalog.Default.pipe(
		Layer.provide(Layer.succeed(PluginLoader, { _tag: "PluginLoader", ...loader })),
	);
};

it.effect("lists providers from every plugin ordered by plugin slug then provider slug", () =>
	Effect.gen(function* () {
		const catalog = yield* IntegrationProviderCatalog;

		expect(catalog.list().map(({ pluginSlug, slug }) => `${pluginSlug}/${slug}`)).toEqual([
			"apple/komga",
			"apple/plex",
			"zebra/radarr",
		]);
	}).pipe(Effect.provide(catalogLayer())),
);

it.effect("resolves a provider lot and script binding by slug", () =>
	Effect.gen(function* () {
		const catalog = yield* IntegrationProviderCatalog;

		expect(catalog.find("komga")).toMatchObject({
			lot: "yank",
			pluginSlug: "apple",
			scriptSlug: "fixture.automation",
		});
		expect(catalog.find("radarr")).toMatchObject({ lot: "push", scriptSlug: null });
		expect(catalog.find("audiobookshelf")).toBeNull();
	}).pipe(Effect.provide(catalogLayer())),
);
