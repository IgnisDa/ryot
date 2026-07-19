import { expect, it } from "@effect/vitest";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
import type { PluginManifest } from "@ryot/plugin-kit/manifest";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { assert } from "vitest";

import { CurrentDb } from "#lib/infrastructure/db/service";
import { makeDefinitionRegistry } from "#modules/definition-registry/service";

import { ImportSourceCatalog } from "./import-source-catalog";
import { makePluginLoader, PluginLoader } from "./loader";
import { fixtureManifest } from "./test-support";
import type { NormalizedPlugin } from "./types";

const epoch = new Date(0);
const fixtureScript = fixtureManifest().scripts[0];
assert(fixtureScript);

const pluginWithImportSources = (
	slug: string,
	importSources: PluginManifest["importSources"],
): NormalizedPlugin => ({
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
				lot: "single",
				input: "file",
				name: "OpenScale",
				slug: "open-scale",
				requiredPluginConfigKeys: [],
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
				requiredPluginConfigKeys: ["tmdbAccessToken"],
			},
			{
				slug: "trakt",
				name: "Trakt",
				input: "payload",
				description: "Trakt account",
				workflowSlug: "trakt-import",
				requiredPluginConfigKeys: ["traktClientId"],
			},
		]),
	]);
	return ImportSourceCatalog.layer.pipe(Layer.provide(Layer.succeed(PluginLoader, { ...loader })));
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
						slug: "trakt",
						name: "Trakt",
						input: "payload",
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
				name: "Fixture Automation",
				slug: "apple.automation",
				contentHash: "script-apple",
				id: SandboxScriptId.make("old-workflow-script"),
				metadata: { ...fixtureScript, slug: "apple.automation" },
			};
			const db = {
				select: () => ({
					from: () => ({ where: () => ({ limit: () => Promise.resolve([row]) }) }),
				}),
			};
			const layer = Layer.merge(
				ImportSourceCatalog.layer.pipe(Layer.provide(Layer.succeed(PluginLoader, { ...loader }))),
				Layer.succeed(CurrentDb, Object.assign(Object.create(null), db)),
			);
			const fiber = yield* Effect.forkChild(
				Effect.gen(function* () {
					const resolution = (yield* ImportSourceCatalog).resolve("trakt");
					yield* Deferred.succeed(selected, undefined);
					yield* Deferred.await(release);
					return resolution
						? { source: resolution.source, script: yield* resolution.script }
						: null;
				}).pipe(Effect.provide(layer)),
			);
			yield* Deferred.await(selected);
			loader.load(pluginWithImportSources("apple", []));
			yield* Deferred.succeed(release, undefined);

			expect(yield* Fiber.join(fiber)).toMatchObject({
				source: { description: "Old source", slug: "trakt" },
				script: { id: "old-workflow-script" },
			});
		}),
);
