import { expect, it } from "@effect/vitest";
import type { PluginManifest } from "@ryot/contract/modules/plugins/manifest";
import { SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { assert } from "vitest";

import { Database } from "#lib/infrastructure/db/service";
import { makeDefinitionRegistry } from "#modules/definition-registry/service";

import { ImportSourceCatalog } from "./import-source-catalog";
import { PluginInstallationRepository } from "./installation-repository";
import { makePluginLoader, PluginLoader, type PluginRegistryEntry } from "./loader";
import { PluginRuntimeResolver } from "./runtime-resolver";
import { fixtureManifest, fixturePluginIdentity } from "./test-support";

const epoch = new Date(0);
const userId = UserId.make("user-1");
const fixtureScript = fixtureManifest().scripts[0];
assert(fixtureScript);
const inputSchema = { fields: {}, unknownKeys: "strict" as const };

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

const activeWorkflowDatabaseLayer = Layer.succeed(
	Database,
	Object.assign(Object.create(null), {
		select: () => ({
			from: () => ({
				where: () => queryable([], Effect.succeed([{ id: "active-workflow-script" }])),
			}),
		}),
	}),
);

const pluginWithImportSources = (
	slug: string,
	importSources: PluginManifest["importSources"],
): PluginRegistryEntry => ({
	...fixturePluginIdentity(slug),
	sourceHash: `source-${slug}`,
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
	manifest: {
		...fixtureManifest(),
		importSources,
		entitySchemas: [],
		signalSchemas: [],
		relationshipSchemas: [],
		metadata: { ...fixtureManifest().metadata, slug },
		bindings: { ...fixtureManifest().bindings, entityAutomations: [] },
		workflows: importSources.map(({ workflowSlug }) => ({
			slug: workflowSlug,
			scriptSlug: `${slug}.automation`,
		})),
		configSchema: {
			unknownKeys: "strict",
			fields: {
				gammaClientId: { type: "string", label: "Gamma client ID", description: "Gamma client ID" },
				alphaAccessToken: {
					type: "string",
					label: "Alpha access token",
					description: "Alpha access token",
				},
			},
		},
	},
});

const catalogLayer = () => {
	const loader = makePluginLoader(makeDefinitionRegistry());
	loader.rebuild([
		pluginWithImportSources("zebra", [
			{
				inputSchema,
				name: "Xi",
				slug: "xi",
				requiredPluginConfigKeys: [],
				description: "Xi export",
				workflowSlug: "xi-import",
			},
		]),
		pluginWithImportSources("apple", [
			{
				inputSchema,
				slug: "nu",
				name: "Nu",
				description: "Nu export",
				workflowSlug: "nu-import",
				requiredPluginConfigKeys: ["alphaAccessToken"],
			},
			{
				inputSchema,
				slug: "gamma",
				name: "Gamma",
				description: "Gamma account",
				workflowSlug: "gamma-import",
				requiredPluginConfigKeys: ["gammaClientId"],
			},
		]),
	]);
	return Layer.merge(
		ImportSourceCatalog.layer.pipe(
			Layer.provide(resolverLayer(loader, activeWorkflowDatabaseLayer)),
		),
		activeWorkflowDatabaseLayer,
	);
};

it.effect("lists import sources with workflow status in stable order", () =>
	Effect.gen(function* () {
		const catalog = yield* ImportSourceCatalog;
		const sources = yield* catalog.listForUser(userId);

		expect(
			sources.map(({ source, hasActiveWorkflow }) => ({
				hasActiveWorkflow,
				slug: `${source.pluginSlug}/${source.slug}`,
			})),
		).toEqual([
			{ slug: "apple/gamma", hasActiveWorkflow: true },
			{ slug: "apple/nu", hasActiveWorkflow: true },
			{ slug: "zebra/xi", hasActiveWorkflow: true },
		]);
	}).pipe(Effect.provide(catalogLayer())),
);

it.effect("carries plugin scope, installation identity and config context on every source", () =>
	Effect.gen(function* () {
		const catalog = yield* ImportSourceCatalog;
		const resolved = yield* catalog.resolveForUser(userId, "gamma");

		expect(resolved?.source).toMatchObject({
			slug: "gamma",
			pluginSlug: "apple",
			pluginScope: "system",
			pluginId: "apple-plugin-id",
			installationId: "apple-plugin-id-installation",
			configContext: { kind: "environment", pluginSlug: "apple" },
		});
		expect(resolved?.script).toMatchObject({ id: "active-workflow-script" });
		expect(yield* catalog.resolveForUser(userId, "missing")).toBeNull();
	}).pipe(Effect.provide(catalogLayer())),
);

it.effect(
	"keeps import source and active workflow resolution on one registry view during replacement",
	() =>
		Effect.gen(function* () {
			const selected = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			const loader = makePluginLoader(makeDefinitionRegistry());
			loader.load(
				pluginWithImportSources("apple", [
					{
						inputSchema,
						slug: "gamma",
						name: "Gamma",
						description: "Old source",
						workflowSlug: "gamma-import",
						requiredPluginConfigKeys: [],
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
				compiledCode: "compiled",
				slug: "apple.automation",
				name: "Fixture Automation",
				contentHash: "script-apple",
				id: SandboxScriptId.make("old-workflow-script"),
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
				ImportSourceCatalog.layer.pipe(Layer.provide(resolverLayer(loader, databaseLayer))),
				databaseLayer,
			);
			const fiber = yield* Effect.forkChild(
				Effect.flatMap(ImportSourceCatalog, (catalog) => catalog.listForUser(userId)).pipe(
					Effect.provide(layer),
				),
			);
			yield* Deferred.await(selected);
			loader.load(pluginWithImportSources("apple", []));
			yield* Deferred.succeed(release, undefined);

			expect(yield* Fiber.join(fiber)).toMatchObject([
				{ hasActiveWorkflow: true, source: { description: "Old source", slug: "gamma" } },
			]);
		}),
);
