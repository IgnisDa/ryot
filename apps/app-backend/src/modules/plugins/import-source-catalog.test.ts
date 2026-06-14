import { expect, it } from "@effect/vitest";
import type { PluginManifest } from "@ryot/contract/modules/plugins/manifest";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { assert } from "vitest";

import { Database } from "#lib/infrastructure/db/service";
import { makeDefinitionRegistry } from "#modules/definition-registry/service";

import { ImportSourceCatalog } from "./import-source-catalog";
import { makePluginLoader, PluginLoader, type PluginRegistryEntry } from "./loader";
import { fixtureManifest, fixturePluginIdentity } from "./test-support";

const epoch = new Date(0);
const fixtureScript = fixtureManifest().scripts[0];
assert(fixtureScript);
const inputSchema = { fields: {}, unknownKeys: "strict" as const };

const activeWorkflowDatabaseLayer = Layer.succeed(
	Database,
	Object.assign(Object.create(null), {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: () => Effect.succeed([{ id: "active-workflow-script" }]),
				}),
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
				traktClientId: { type: "string", label: "Trakt client ID", description: "Trakt client ID" },
				tmdbAccessToken: {
					type: "string",
					label: "TMDB access token",
					description: "TMDB access token",
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
				name: "OpenScale",
				slug: "open-scale",
				requiredPluginConfigKeys: [],
				description: "OpenScale export",
				workflowSlug: "open-scale-import",
			},
		]),
		pluginWithImportSources("apple", [
			{
				inputSchema,
				slug: "netflix",
				name: "Netflix",
				description: "Netflix export",
				workflowSlug: "netflix-import",
				requiredPluginConfigKeys: ["tmdbAccessToken"],
			},
			{
				inputSchema,
				slug: "trakt",
				name: "Trakt",
				description: "Trakt account",
				workflowSlug: "trakt-import",
				requiredPluginConfigKeys: ["traktClientId"],
			},
		]),
	]);
	return Layer.merge(
		ImportSourceCatalog.layer.pipe(Layer.provide(Layer.succeed(PluginLoader, { ...loader }))),
		activeWorkflowDatabaseLayer,
	);
};

it.effect("lists import sources with workflow status in stable order", () =>
	Effect.gen(function* () {
		const catalog = yield* ImportSourceCatalog;
		const sources = yield* catalog.listWithWorkflowStatus;

		expect(
			sources.map(({ source, hasActiveWorkflow }) => ({
				hasActiveWorkflow,
				slug: `${source.pluginSlug}/${source.slug}`,
			})),
		).toEqual([
			{ slug: "apple/netflix", hasActiveWorkflow: true },
			{ slug: "apple/trakt", hasActiveWorkflow: true },
			{ slug: "zebra/open-scale", hasActiveWorkflow: true },
		]);
	}).pipe(Effect.provide(catalogLayer())),
);

it.effect(
	"keeps import source and active workflow resolution on one snapshot during replacement",
	() =>
		Effect.gen(function* () {
			const selected = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			const loader = makePluginLoader(makeDefinitionRegistry());
			loader.load(
				pluginWithImportSources("apple", [
					{
						inputSchema,
						slug: "trakt",
						name: "Trakt",
						description: "Old source",
						workflowSlug: "trakt-import",
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
						where: () => ({
							limit: () =>
								Effect.gen(function* () {
									yield* Deferred.succeed(selected, undefined);
									yield* Deferred.await(release);
									return [row];
								}),
						}),
					}),
				}),
			};
			const layer = Layer.merge(
				ImportSourceCatalog.layer.pipe(Layer.provide(Layer.succeed(PluginLoader, { ...loader }))),
				Layer.succeed(Database, Object.assign(Object.create(null), db)),
			);
			const fiber = yield* Effect.forkChild(
				Effect.flatMap(ImportSourceCatalog, (catalog) => catalog.listWithWorkflowStatus).pipe(
					Effect.provide(layer),
				),
			);
			yield* Deferred.await(selected);
			loader.load(pluginWithImportSources("apple", []));
			yield* Deferred.succeed(release, undefined);

			expect(yield* Fiber.join(fiber)).toMatchObject([
				{ hasActiveWorkflow: true, source: { description: "Old source", slug: "trakt" } },
			]);
		}),
);
