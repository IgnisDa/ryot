import {
	PluginConflictError,
	PluginNotFoundError,
} from "@ryot-app/contract/modules/plugins/schemas";
import { PluginId, PluginSlug } from "@ryot-app/contract/schema/brands";
import { inArray } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { kernelDefinitionSource, kernelScripts } from "#modules/definition-registry/kernel-source";
import { DefinitionRepository } from "#modules/definition-registry/repository";

import { PluginCatalogInvalidator } from "./catalog-events";
import {
	normalizePluginPackage,
	normalizePluginSource,
	structurePluginFailure,
	validationDiagnostics,
} from "./pipeline";
import { PluginRepository } from "./repository";
import { PluginRevisionActivation } from "./revision-activation";
import { validateAdditiveSchemaEvolution } from "./schema-evolution";
import { SystemPlugins } from "./system";
import { validateSystemPluginSet } from "./system-set";
import type { NormalizedPlugin, PluginSource, StoredPlugin } from "./types";
import {
	PluginValidationError,
	validateIntegrationProviderSettingsSchemas,
	validateImportSourceInputSchemas,
	validatePluginExecutableScripts,
	validatePluginManifestPolicy,
	validatePluginManifestReferences,
	validatePluginSourcePaths,
	validateSignalSchemaFormatterReferences,
} from "./validation";

type SystemSetEntry = Pick<StoredPlugin, "id" | "manifest" | "scripts" | "slug">;

const toSystemPluginItem = (plugin: Pick<NormalizedPlugin, "manifest" | "sourceHash">) => ({
	...plugin.manifest.metadata,
	sourceHash: plugin.sourceHash,
	slug: PluginSlug.make(plugin.manifest.metadata.slug),
});

export class PluginIngestionService extends Context.Service<PluginIngestionService>()(
	"PluginIngestionService",
	{
		make: Effect.gen(function* () {
			const database = yield* Database;
			const repository = yield* PluginRepository;
			const activation = yield* PluginRevisionActivation;
			const definitions = yield* DefinitionRepository;
			const systemPlugins = yield* SystemPlugins;
			const invalidator = yield* PluginCatalogInvalidator;
			const kernelSignalSlugs = new Set(
				kernelDefinitionSource().signalSchemas.map(({ slug }) => slug),
			);
			const validateSystemSet = Effect.fn("PluginIngestionService.validateSystemSet")(function* (
				plugins: ReadonlyArray<SystemSetEntry>,
				validateCompiledScripts = true,
			) {
				const kernel = yield* definitions.readKernelSource;
				const snapshot = yield* Effect.try({
					try: () => validateSystemPluginSet(kernel, plugins),
					catch: (error) => new PluginValidationError({ issues: [String(error)] }),
				});
				yield* validateSignalSchemaFormatterReferences(
					snapshot,
					plugins.flatMap(({ manifest }) => manifest.scripts),
					kernelScripts,
					kernelSignalSlugs,
				);
				yield* Effect.forEach(
					plugins,
					(plugin) =>
						validatePluginManifestReferences(plugin.manifest, snapshot).pipe(
							Effect.andThen(validateIntegrationProviderSettingsSchemas(plugin.manifest)),
							Effect.andThen(validateImportSourceInputSchemas(plugin.manifest)),
							Effect.andThen(
								validateCompiledScripts ? validatePluginExecutableScripts(plugin) : Effect.void,
							),
						),
					{ discard: true },
				);
			});
			const validateActiveSystemPlugins = Effect.fn(
				"PluginIngestionService.validateActiveSystemPlugins",
			)(function* () {
				yield* validateSystemSet(yield* repository.listActiveSystemPlugins());
			});
			const assertNoCustomViewSlugCollisions = Effect.fn(function* (
				manifest: NormalizedPlugin["manifest"],
			) {
				const slugs = manifest.savedViews.map((view) => view.slug);
				if (slugs.length === 0) {
					return yield* Effect.void;
				}
				const db = yield* Database;
				const [collision] = yield* mapDatabaseErrors(
					db
						.select({ slug: schema.savedView.slug })
						.from(schema.savedView)
						.where(inArray(schema.savedView.slug, slugs))
						.limit(1),
				);
				if (collision) {
					return yield* new PluginValidationError({
						issues: [`Saved view slug '${collision.slug}' is owned by a custom view`],
					});
				}
				return yield* Effect.void;
			});
			const inTransaction = <A, E>(effect: Effect.Effect<A, E, Database>) =>
				Effect.uninterruptible(
					mapDatabaseErrors(
						database.transaction((transaction) =>
							repository
								.lockIngestion()
								.pipe(Effect.andThen(effect), Effect.provideService(Database, transaction)),
						),
					),
				);

			const ingestSystemPluginUnlocked = Effect.fn(
				"PluginIngestionService.ingestSystemPluginUnlocked",
			)(function* (source: PluginSource) {
				const normalizedSource = yield* normalizePluginSource(source);
				const { files, manifest, sourceHash } = normalizedSource;
				yield* validatePluginManifestPolicy(manifest, { scope: "system" });
				yield* validatePluginSourcePaths(files, manifest);
				const slug = manifest.metadata.slug;
				const installed = yield* repository
					.listActiveSystemPlugins()
					.pipe(Effect.provideService(Database, database));
				yield* validateSystemSet(
					[
						...installed.filter((plugin) => plugin.slug !== slug),
						{ slug, manifest, scripts: [], id: `pending:${slug}` },
					],
					false,
				).pipe(Effect.provideService(Database, database));

				const cached = yield* repository
					.findBySourceHash({ slug, sourceHash, ownerId: null, scope: "system" })
					.pipe(Effect.provideService(Database, database));
				if (cached) {
					const committed = yield* inTransaction(
						Effect.gen(function* () {
							const plugins = yield* repository.listActiveSystemPlugins();
							const authoritative = plugins.find(
								(plugin) => plugin.slug === slug && plugin.sourceHash === sourceHash,
							);
							if (!authoritative) {
								return null;
							}
							yield* validateSystemSet(plugins);
							yield* repository.resolveEnvironmentConfig(authoritative);
							return authoritative;
						}),
					);
					if (committed) {
						yield* invalidator.all;
						return committed;
					}
				}

				const normalized = yield* normalizePluginPackage(normalizedSource);
				const stored = yield* inTransaction(
					Effect.gen(function* () {
						yield* assertNoCustomViewSlugCollisions(manifest);
						const previous = yield* repository.findActiveSystemPlugin(slug);
						if (previous) {
							yield* validateAdditiveSchemaEvolution(previous.manifest, manifest);
						}
						const pluginId = yield* repository.persist(normalized, {
							slug,
							ownerId: null,
							scope: "system",
						});
						yield* activation.activated(pluginId);
						const plugins = yield* repository.listActiveSystemPlugins();
						yield* validateSystemSet(plugins);
						const entry = plugins.find((plugin) => plugin.id === pluginId);
						if (!entry) {
							return yield* new PluginValidationError({
								issues: [`System plugin ${slug} is not active after ingestion`],
							});
						}
						yield* repository.resolveEnvironmentConfig(entry);
						return entry;
					}),
				);
				yield* invalidator.all;
				return stored;
			});
			const ingestSystemPlugin = Effect.fn("PluginIngestionService.ingestSystemPlugin")(
				(source: PluginSource) => ingestSystemPluginUnlocked(source).pipe(structurePluginFailure),
			);

			const listPlugins = Effect.fn("PluginIngestionService.listPlugins")(function* () {
				const plugins = yield* repository.listActiveSystemPlugins();
				return plugins.map(toSystemPluginItem);
			});

			const installPlugin = Effect.fn("PluginIngestionService.installPlugin")(function* (
				source: PluginSource,
			) {
				const installed = yield* ingestSystemPlugin(source);
				return { pluginId: PluginId.make(installed.id), slug: PluginSlug.make(installed.slug) };
			});

			const uninstallPlugin = Effect.fn("PluginIngestionService.uninstallPlugin")(function* (
				slug: string,
			) {
				const pluginSlug = PluginSlug.make(slug);
				const removed = yield* inTransaction(
					Effect.gen(function* () {
						const installed = yield* repository.listActiveSystemPlugins();
						const plugin = installed.find((candidate) => candidate.slug === slug);
						if (!plugin) {
							return yield* new PluginNotFoundError({
								reason: { pluginSlug, code: "plugin-not-found" },
							});
						}
						if (systemPlugins.slugs.has(slug)) {
							return yield* new PluginConflictError({
								reason: { pluginSlug, code: "system-plugin" },
							});
						}
						if (yield* repository.hasIntegrationReferences({ pluginId: plugin.id })) {
							return yield* new PluginConflictError({
								reason: { pluginSlug, code: "integration-referenced" },
							});
						}
						const schemaSlugs = plugin.manifest.entitySchemas.map(
							({ slug: entitySchemaSlug }) => entitySchemaSlug,
						);
						if (
							yield* repository.hasEntityReferences({
								pluginId: plugin.id,
								entitySchemaSlugs: schemaSlugs,
							})
						) {
							return yield* new PluginConflictError({
								reason: { pluginSlug, code: "entity-referenced" },
							});
						}
						if (yield* repository.hasDefinitionReferences(plugin.id)) {
							return yield* new PluginConflictError({
								reason: { pluginSlug, code: "entity-referenced" },
							});
						}
						const dangling = yield* validateSystemSet(
							installed.filter((candidate) => candidate.slug !== slug),
						).pipe(
							Effect.as(null),
							Effect.catchTag("PluginValidationError", (error) => Effect.succeed(error)),
						);
						if (dangling) {
							return yield* new PluginConflictError({
								reason: {
									pluginSlug,
									code: "definition-referenced",
									diagnostics: validationDiagnostics(dangling),
								},
							});
						}
						yield* repository.deactivate(plugin.id);
						return plugin.id;
					}),
				);
				yield* invalidator.all;
				return { pluginId: PluginId.make(removed) };
			});

			return {
				listPlugins,
				installPlugin,
				uninstallPlugin,
				ingestSystemPlugin,
				validateActiveSystemPlugins,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
