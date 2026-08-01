import { expect, it } from "@effect/vitest";
import type { PluginManifest } from "@ryot/contract/modules/plugins/manifest";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { assert } from "vitest";

import { CurrentDb } from "#lib/infrastructure/db/service";
import { makeDefinitionRegistry } from "#modules/definition-registry/service";

import { IntegrationProviderCatalog } from "./integration-provider-catalog";
import { makePluginLoader, PluginLoader } from "./loader";
import { fixtureManifest } from "./test-support";
import type { NormalizedPlugin } from "./types";

const settingsSchema = {
	fields: { token: { type: "string", label: "Token", description: "API token", secret: true } },
} satisfies PluginManifest["integrationProviders"][number]["settingsSchema"];
const epoch = new Date(0);
const fixtureScript = fixtureManifest().scripts[0];
assert(fixtureScript);

const pluginWithProviders = (
	slug: string,
	integrationProviders: PluginManifest["integrationProviders"],
): NormalizedPlugin => ({
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
	scripts: [
		{
			source: "source",
			compiledFormat: 1,
			compiledCode: "compiled",
			name: "Fixture Automation",
			slug: `${slug}.automation`,
			contentHash: `script-${slug}`,
			entry: "scripts/fixture.sandbox.ts",
			metadata: { ...fixtureScript, slug: `${slug}.automation` },
		},
	],
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
	return IntegrationProviderCatalog.layer.pipe(
		Layer.provide(Layer.succeed(PluginLoader, { ...loader })),
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

it.effect("does not resolve a replacement plugin for a persisted provider owner", () =>
	Effect.gen(function* () {
		const catalog = yield* IntegrationProviderCatalog;

		expect(catalog.findOwned("komga", "apple")).toMatchObject({
			slug: "komga",
			pluginSlug: "apple",
		});
		expect(catalog.findOwned("komga", "replacement")).toBeNull();
		expect(catalog.resolveOwned("komga", "replacement")).toBeNull();
	}).pipe(Effect.provide(catalogLayer())),
);

it.effect("keeps provider and active script resolution on one snapshot during replacement", () =>
	Effect.gen(function* () {
		const selected = yield* Deferred.make<void>();
		const release = yield* Deferred.make<void>();
		const loader = makePluginLoader(makeDefinitionRegistry());
		loader.load(
			pluginWithProviders("apple", [
				{
					lot: "yank",
					slug: "komga",
					name: "Komga",
					settingsSchema,
					description: "Old provider",
					scriptSlug: "apple.automation",
				},
			]),
		);
		const row = {
			source: "source",
			createdAt: epoch,
			updatedAt: epoch,
			providerId: null,
			compiledFormat: 1,
			pluginSlug: "apple",
			slug: "apple.automation",
			compiledCode: "compiled",
			name: "Fixture Automation",
			contentHash: "script-apple",
			id: SandboxScriptId.make("old-script"),
			metadata: { ...fixtureScript, slug: "apple.automation" },
		};
		const db = {
			select: () => ({
				from: () => ({ where: () => ({ limit: () => Promise.resolve([row]) }) }),
			}),
		};
		const layer = Layer.merge(
			IntegrationProviderCatalog.layer.pipe(
				Layer.provide(Layer.succeed(PluginLoader, { ...loader })),
			),
			Layer.succeed(CurrentDb, Object.assign(Object.create(null), db)),
		);
		const fiber = yield* Effect.forkChild(
			Effect.gen(function* () {
				const resolution = (yield* IntegrationProviderCatalog).resolveOwned("komga", "apple");
				yield* Deferred.succeed(selected, undefined);
				yield* Deferred.await(release);
				return resolution
					? { provider: resolution.provider, script: yield* resolution.script }
					: null;
			}).pipe(Effect.provide(layer)),
		);
		yield* Deferred.await(selected);
		loader.load(pluginWithProviders("apple", []));
		yield* Deferred.succeed(release, undefined);

		expect(yield* Fiber.join(fiber)).toMatchObject({
			provider: { description: "Old provider", slug: "komga" },
			script: { id: "old-script", contentHash: "script-apple" },
		});
	}),
);
