import { expect, it } from "@effect/vitest";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { assert } from "vitest";

import { Database } from "#lib/infrastructure/db/service";
import { makeDefinitionRegistry } from "#modules/definition-registry/service";

import { PluginInstallationRepository } from "./installation-repository";
import { IntegrationProviderCatalog } from "./integration-provider-catalog";
import { makePluginLoader, PluginLoader } from "./loader";
import { PluginRuntimeResolver } from "./runtime-resolver";
import { fixtureManifest, fixturePluginIdentity } from "./test-support";

const settingsSchema = {
	fields: { token: { type: "string", label: "Token", description: "API token", secret: true } },
} satisfies PluginManifest["integrationProviders"][number]["settingsSchema"];
const epoch = new Date(0);
const userId = UserId.make("user-1");
const fixtureScript = fixtureManifest().scripts[0];
assert(fixtureScript);

const queryable = (rows: ReadonlyArray<unknown>, limited: Effect.Effect<ReadonlyArray<unknown>>) =>
	Object.assign(Effect.succeed(rows), { limit: () => limited });

const installationFor = (plugin: { id: string; slug: string }) =>
	Object.assign(Object.create(null), {
		userId,
		config: {},
		sortOrder: 0,
		health: "ready",
		isDisabled: false,
		healthReason: null,
		pluginId: plugin.id,
		pluginScope: "system",
		pluginSlug: plugin.slug,
		id: `${plugin.id}-installation`,
	});

const resolverLayer = (
	loader: ReturnType<typeof makePluginLoader>,
	database: Layer.Layer<Database>,
) =>
	PluginRuntimeResolver.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(PluginLoader, { ...loader }),
				Layer.mock(PluginInstallationRepository)({
					listForUser: () =>
						Effect.sync(() => Object.values(loader.getSnapshot().plugins).map(installationFor)),
				}),
				database,
			),
		),
	);

const scriptDatabaseLayer = Layer.succeed(
	Database,
	Object.assign(Object.create(null), {
		select: () => ({
			from: () => ({ where: () => queryable([], Effect.succeed([{ id: "active-script" }])) }),
		}),
	}),
);

const pluginWithProviders = (
	slug: string,
	integrationProviders: PluginManifest["integrationProviders"],
) => ({
	...fixturePluginIdentity(slug),
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
			entry: "backend/automations/fixture.sandbox.ts",
			metadata: { ...fixtureScript, slug: `${slug}.automation` },
		},
	],
});

const catalogLayer = () => {
	const loader = makePluginLoader(makeDefinitionRegistry());
	loader.rebuild([
		pluginWithProviders("zebra", [
			{ settingsSchema, slug: "iota", lot: "push", name: "Iota", description: "Iota push" },
		]),
		pluginWithProviders("apple", [
			{
				lot: "sink",
				name: "Lambda",
				slug: "lambda",
				settingsSchema,
				description: "Lambda sink",
				scriptSlug: "apple.automation",
			},
			{
				lot: "yank",
				slug: "theta",
				name: "Theta",
				settingsSchema,
				description: "Theta yank",
				scriptSlug: "apple.automation",
			},
		]),
	]);
	return Layer.merge(
		IntegrationProviderCatalog.layer.pipe(
			Layer.provide(resolverLayer(loader, scriptDatabaseLayer)),
		),
		scriptDatabaseLayer,
	);
};

it.effect("lists providers from every plugin ordered by plugin slug then provider slug", () =>
	Effect.gen(function* () {
		const catalog = yield* IntegrationProviderCatalog;

		expect(
			(yield* catalog.listForUser(userId)).map(({ pluginSlug, slug }) => `${pluginSlug}/${slug}`),
		).toEqual(["apple/lambda", "apple/theta", "zebra/iota"]);
	}).pipe(Effect.provide(catalogLayer())),
);

it.effect("resolves a provider lot, script binding and installation identity by slug", () =>
	Effect.gen(function* () {
		const catalog = yield* IntegrationProviderCatalog;

		expect(yield* catalog.findForUser(userId, "theta")).toMatchObject({
			lot: "yank",
			pluginSlug: "apple",
			pluginScope: "system",
			pluginId: "apple-plugin-id",
			scriptSlug: "apple.automation",
			installationId: "apple-plugin-id-installation",
			configContext: { kind: "environment", pluginSlug: "apple" },
		});
		expect(yield* catalog.findForUser(userId, "iota")).toMatchObject({
			lot: "push",
			scriptSlug: null,
		});
		expect(yield* catalog.findForUser(userId, "mu")).toBeNull();
	}).pipe(Effect.provide(catalogLayer())),
);

it.effect("does not resolve a provider for another installation", () =>
	Effect.gen(function* () {
		const catalog = yield* IntegrationProviderCatalog;

		expect(
			yield* catalog.findOwnedForUser(userId, "theta", "apple-plugin-id-installation"),
		).toMatchObject({ slug: "theta", pluginSlug: "apple" });
		expect(yield* catalog.findOwnedForUser(userId, "theta", "other-installation")).toBeNull();
		expect(yield* catalog.resolveOwnedForUser(userId, "theta", "other-installation")).toBeNull();
	}).pipe(Effect.provide(catalogLayer())),
);

it.effect(
	"keeps provider and active script resolution on one registry view during replacement",
	() =>
		Effect.gen(function* () {
			const selected = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			const loader = makePluginLoader(makeDefinitionRegistry());
			loader.load(
				pluginWithProviders("apple", [
					{
						lot: "yank",
						slug: "theta",
						name: "Theta",
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
					from: () => ({
						where: () =>
							queryable(
								[],
								Effect.gen(function* () {
									yield* Deferred.succeed(selected, undefined);
									yield* Deferred.await(release);
									return [row];
								}),
							),
					}),
				}),
			};
			const databaseLayer = Layer.succeed(Database, Object.assign(Object.create(null), db));
			const layer = Layer.merge(
				IntegrationProviderCatalog.layer.pipe(Layer.provide(resolverLayer(loader, databaseLayer))),
				databaseLayer,
			);
			const fiber = yield* Effect.forkChild(
				Effect.flatMap(IntegrationProviderCatalog, (catalog) =>
					catalog.resolveOwnedForUser(userId, "theta", "apple-plugin-id-installation"),
				).pipe(Effect.provide(layer)),
			);
			yield* Deferred.await(selected);
			loader.load(pluginWithProviders("apple", []));
			yield* Deferred.succeed(release, undefined);

			expect(yield* Fiber.join(fiber)).toMatchObject({
				provider: { description: "Old provider", slug: "theta" },
				script: { id: "old-script", contentHash: "script-apple" },
			});
		}),
);
