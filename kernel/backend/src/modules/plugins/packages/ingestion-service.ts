import { DbError } from "@ryot-app/contract/errors";
import {
	PluginConflictError,
	PluginNotFoundError,
	PluginRequestError,
} from "@ryot-app/contract/modules/plugins/schemas";
import { PluginId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { kernelDefinitionSource, kernelScripts } from "#modules/definitions/kernel-source";
import { DefinitionRepository } from "#modules/definitions/repository";
import { DatabaseSession } from "#platform/db/session";

import { PluginCatalogInvalidator } from "../catalog/events";
import { PluginInstallationRepository } from "../installations/repository";
import {
	PluginIngestionRetirement,
	quarantinePackageConflicts,
	retireQuarantinedInstallations,
} from "./ingestion-retirement";
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
	validateImportSourceInputSchemas,
	validateIntegrationProviderSettingsSchemas,
	validatePluginExecutableScripts,
	validatePluginManifestPolicy,
	validatePluginManifestReferences,
	validatePluginScriptEntries,
	validateSignalSchemaFormatterReferences,
} from "./validation";

type SystemSetEntry = Pick<StoredPlugin, "id" | "manifest" | "scripts">;
type EnvironmentResolutionTiming = "deferred" | "immediate";

const toSystemPluginItem = (plugin: Pick<NormalizedPlugin, "manifest" | "contentHash">) => ({
	...plugin.manifest.metadata,
	contentHash: plugin.contentHash,
});

export class PluginIngestionService extends Context.Service<PluginIngestionService>()(
	"PluginIngestionService",
	{
		make: Effect.gen(function* () {
			const database = yield* DatabaseSession;
			const repository = yield* PluginRepository;
			const activation = yield* PluginRevisionActivation;
			const definitions = yield* DefinitionRepository;
			const systemPlugins = yield* SystemPlugins;
			const invalidator = yield* PluginCatalogInvalidator;
			const installations = yield* PluginInstallationRepository;
			const retirement = yield* PluginIngestionRetirement;
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
				yield* validateSignalSchemaFormatterReferences(snapshot, kernelScripts, kernelSignalSlugs);
				yield* Effect.forEach(
					plugins,
					(plugin) =>
						validatePluginManifestReferences(plugin.manifest).pipe(
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
			const inTransaction = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
				Effect.uninterruptible(
					database.transaction(repository.lockIngestion().pipe(Effect.andThen(effect))),
				).pipe(
					Effect.catchTag("DatabaseSessionStateError", () =>
						Effect.fail(new DbError({ message: "Plugin ingestion requires a root transaction" })),
					),
				);

			const ingestSystemPluginUnlocked = Effect.fn(
				"PluginIngestionService.ingestSystemPluginUnlocked",
			)(function* (
				source: PluginSource,
				environmentResolution: EnvironmentResolutionTiming,
				target?: { readonly pluginId: string; readonly expectedContentHash: string },
				createOnly = false,
			) {
				const normalizedSource = yield* normalizePluginSource(source);
				const { manifest, contentHash } = normalizedSource;
				yield* validatePluginManifestPolicy(manifest, { scope: "system" });
				yield* validatePluginScriptEntries(manifest);
				const packageId = manifest.metadata.packageId;
				const installed = yield* repository.listActiveSystemPlugins();
				const selected = target ? installed.find(({ id }) => id === target.pluginId) : undefined;
				if (selected && selected.packageId !== packageId) {
					return yield* new PluginRequestError({
						reason: {
							packageId,
							code: "package-id-mismatch",
							pluginId: PluginId.make(selected.id),
							expectedPackageId: selected.packageId,
						},
					});
				}
				yield* validateSystemSet(
					[
						...installed.filter((plugin) =>
							target ? plugin.id !== target.pluginId : plugin.packageId !== packageId,
						),
						{ manifest, scripts: [], id: target?.pluginId ?? `pending:${packageId}` },
					],
					false,
				);

				const cached = yield* repository.findByContentHash({
					packageId,
					...(target ? { pluginId: target.pluginId } : {}),
					contentHash,
					ownerId: null,
					scope: "system",
				});
				if (cached && !target && !createOnly) {
					const committed = yield* inTransaction(
						Effect.gen(function* () {
							const plugins = yield* repository.listActiveSystemPlugins();
							const authoritative = plugins.find(
								(plugin) => plugin.packageId === packageId && plugin.contentHash === contentHash,
							);
							if (!authoritative) {
								return null;
							}
							yield* validateSystemSet(plugins);
							if (environmentResolution === "immediate") {
								yield* repository.resolveEnvironmentConfig(authoritative);
							}
							yield* invalidator.recordAll;
							const quarantined = yield* quarantinePackageConflicts(
								installations,
								invalidator,
								packageId,
							);
							return { quarantined, authoritative };
						}),
					);
					if (committed) {
						yield* invalidator.all;
						yield* retireQuarantinedInstallations(retirement, committed.quarantined);
						return committed.authoritative;
					}
				}

				const normalized = normalizePluginPackage(normalizedSource);
				const stored = yield* inTransaction(
					Effect.gen(function* () {
						const previous = target
							? yield* repository.findActiveSystemPluginById(target.pluginId)
							: yield* repository.findActiveSystemPluginByPackageId(packageId);
						if (createOnly && previous) {
							return yield* new PluginConflictError({
								reason: { packageId, code: "already-installed" },
							});
						}
						if (target && (!previous || previous.contentHash !== target.expectedContentHash)) {
							return yield* new PluginConflictError({
								reason: { code: "source-revision-stale", pluginId: PluginId.make(target.pluginId) },
							});
						}
						if (previous && previous.packageId !== packageId) {
							return yield* new PluginRequestError({
								reason: {
									packageId,
									code: "package-id-mismatch",
									pluginId: PluginId.make(previous.id),
									expectedPackageId: previous.packageId,
								},
							});
						}
						if (previous) {
							yield* validateAdditiveSchemaEvolution(previous.manifest, manifest);
							const declarations = yield* repository.findReferencedRemovedDeclarations(
								previous,
								manifest,
							);
							if (declarations.length > 0) {
								return yield* new PluginConflictError({
									reason: {
										declarations,
										pluginId: PluginId.make(previous.id),
										code: "referenced-definition-incompatible",
									},
								});
							}
						}
						const pluginId = yield* repository.persist(normalized, {
							...(target ? { pluginId: target.pluginId } : {}),
							ownerId: null,
							scope: "system",
						});
						yield* activation.activated(pluginId);
						const plugins = yield* repository.listActiveSystemPlugins();
						yield* validateSystemSet(plugins);
						const entry = plugins.find((plugin) => plugin.id === pluginId);
						if (!entry) {
							return yield* new PluginValidationError({
								issues: [`System plugin ${packageId} is not active after ingestion`],
							});
						}
						if (environmentResolution === "immediate") {
							yield* repository.resolveEnvironmentConfig(entry);
						}
						yield* invalidator.recordAll;
						const quarantined = yield* quarantinePackageConflicts(
							installations,
							invalidator,
							packageId,
						);
						return { entry, quarantined };
					}),
				);
				yield* invalidator.all;
				yield* retireQuarantinedInstallations(retirement, stored.quarantined);
				return stored.entry;
			});
			const ingestSystemPluginSource = (
				source: PluginSource,
				environmentResolution: EnvironmentResolutionTiming,
			) => ingestSystemPluginUnlocked(source, environmentResolution).pipe(structurePluginFailure);
			const ingestSystemPlugin = Effect.fn("PluginIngestionService.ingestSystemPlugin")(
				(source: PluginSource) => ingestSystemPluginSource(source, "immediate"),
			);
			const synchronizeSystemPlugins = Effect.fn("PluginIngestionService.synchronizeSystemPlugins")(
				function* (sources: ReadonlyArray<PluginSource>) {
					for (const source of sources) {
						yield* ingestSystemPluginSource(source, "deferred");
					}
					yield* inTransaction(repository.resolveEnvironmentConfigs());
				},
			);

			const listPlugins = Effect.fn("PluginIngestionService.listPlugins")(function* () {
				const plugins = yield* repository.listActiveSystemPlugins();
				return plugins.map(toSystemPluginItem);
			});

			const installPlugin = Effect.fn("PluginIngestionService.installPlugin")(function* (
				source: PluginSource,
			) {
				const normalized = yield* normalizePluginSource(source).pipe(structurePluginFailure);
				if (
					yield* repository.findActiveSystemPluginByPackageId(
						normalized.manifest.metadata.packageId,
					)
				) {
					return yield* new PluginConflictError({
						reason: {
							code: "already-installed",
							packageId: normalized.manifest.metadata.packageId,
						},
					});
				}
				const installed = yield* ingestSystemPluginUnlocked(
					source,
					"immediate",
					undefined,
					true,
				).pipe(structurePluginFailure);
				return { pluginId: PluginId.make(installed.id) };
			});
			const updatePlugin = Effect.fn("PluginIngestionService.updatePlugin")(function* (
				input: PluginSource & { readonly pluginId: string; readonly contentHash: string },
			) {
				const installed = yield* ingestSystemPluginUnlocked(input, "immediate", {
					pluginId: input.pluginId,
					expectedContentHash: input.contentHash,
				}).pipe(structurePluginFailure);
				return { pluginId: PluginId.make(installed.id) };
			});

			const uninstallPlugin = Effect.fn("PluginIngestionService.uninstallPlugin")(function* (
				pluginId: string,
				activationId: string,
			) {
				const localPluginId = PluginId.make(pluginId);
				const removed = yield* inTransaction(
					Effect.gen(function* () {
						const receipt = yield* repository.findUninstallReceipt(activationId);
						if (receipt?.ownerId === null && receipt.pluginId === pluginId) {
							return receipt.pluginId;
						}
						const installed = yield* repository.listActiveSystemPlugins();
						const plugin = installed.find((candidate) => candidate.id === pluginId);
						if (!plugin || plugin.activationId !== activationId) {
							return yield* new PluginNotFoundError({
								reason: { pluginId: localPluginId, code: "plugin-not-found" },
							});
						}
						if (systemPlugins.packageIds.has(plugin.packageId)) {
							return yield* new PluginConflictError({
								reason: { code: "system-plugin", pluginId: localPluginId },
							});
						}
						if (yield* repository.hasIntegrationReferences({ pluginId: plugin.id })) {
							return yield* new PluginConflictError({
								reason: { pluginId: localPluginId, code: "integration-referenced" },
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
								reason: { pluginId: localPluginId, code: "entity-referenced" },
							});
						}
						if (yield* repository.hasDefinitionReferences(plugin.id)) {
							return yield* new PluginConflictError({
								reason: { pluginId: localPluginId, code: "entity-referenced" },
							});
						}
						const dangling = yield* validateSystemSet(
							installed.filter((candidate) => candidate.id !== pluginId),
						).pipe(
							Effect.as(null),
							Effect.catchTag("PluginValidationError", (error) => Effect.succeed(error)),
						);
						if (dangling) {
							return yield* new PluginConflictError({
								reason: {
									pluginId: localPluginId,
									code: "definition-referenced",
									diagnostics: validationDiagnostics(dangling),
								},
							});
						}
						yield* repository.deactivate(plugin.id);
						yield* repository.recordUninstallReceipt({
							activationId,
							ownerId: null,
							pluginId: plugin.id,
							installationId: null,
							packageId: plugin.packageId,
						});
						yield* invalidator.recordAll;
						return plugin.id;
					}),
				);
				yield* invalidator.all;
				return { pluginId: PluginId.make(removed) };
			});

			return {
				listPlugins,
				updatePlugin,
				installPlugin,
				uninstallPlugin,
				ingestSystemPlugin,
				synchronizeSystemPlugins,
				validateActiveSystemPlugins,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
