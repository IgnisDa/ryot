import { DbError } from "@ryot-app/contract/errors";
import {
	PluginConflictError,
	PluginNotFoundError,
	PluginRequestError,
} from "@ryot-app/contract/modules/plugins/schemas";
import { PluginId } from "@ryot-app/contract/schema/brands";
import { kernelDefinitionSource } from "@ryot-app/definitions/kernel-definitions";
import { Context, Effect, Layer } from "effect";

import { kernelScripts } from "#modules/definitions/builtin-scripts";
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
	checkedPluginSource,
	normalizePluginPackage,
	structurePluginFailure,
	validationDiagnostics,
} from "./pipeline";
import { PluginRepository } from "./repository";
import { PluginRevisionActivation } from "./revision-activation";
import { validateAdditiveSchemaEvolution } from "./schema-evolution";
import { SystemPlugins } from "./system";
import { validateSystemPluginDeployment } from "./system-set";
import type { NormalizedPlugin, PluginSource, StoredPlugin } from "./types";
import {
	decodePluginManifest,
	PluginValidationError,
	validateImportSourceInputSchemas,
	validateIntegrationProviderSettingsSchemas,
	validatePluginExecutableScripts,
	validatePluginManifestPolicy,
	validatePluginManifestReferences,
	validatePluginScriptEntries,
	validateSignalSchemaFormatterReferences,
} from "./validation";
import { type PluginValidationSession, PluginValidationWorker } from "./validation-worker";

type EnvironmentResolutionTiming = "deferred" | "immediate";
type SystemSetEntry = Pick<StoredPlugin, "id" | "scripts" | "manifest">;

const toSystemPluginItem = (plugin: Pick<NormalizedPlugin, "manifest" | "contentHash">) => ({
	...plugin.manifest.metadata,
	contentHash: plugin.contentHash,
});

export class PluginIngestionService extends Context.Service<PluginIngestionService>()(
	"@ryot-app/kernel-backend/modules/plugins/packages/ingestion-service/PluginIngestionService",
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
			const validationWorker = yield* PluginValidationWorker;
			const kernelSignalSlugs = new Set(
				kernelDefinitionSource().signalSchemas.map(({ slug }) => slug),
			);
			const validateSystemSet = Effect.fn("PluginIngestionService.validateSystemSet")(function* (
				worker: PluginValidationSession,
				plugins: ReadonlyArray<SystemSetEntry>,
				changedPluginIds?: ReadonlySet<string>,
			) {
				const kernel = yield* definitions.readKernelSource;
				yield* Effect.try({
					try: () => validateSystemPluginDeployment(plugins),
					catch: (error) => new PluginValidationError({ issues: [String(error)] }),
				});
				yield* validateSignalSchemaFormatterReferences(
					kernel.signalSchemas,
					kernelScripts,
					kernelSignalSlugs,
				);
				yield* Effect.forEach(
					plugins,
					(plugin) =>
						validatePluginManifestReferences(plugin.manifest).pipe(
							Effect.andThen(validateIntegrationProviderSettingsSchemas(plugin.manifest)),
							Effect.andThen(validateImportSourceInputSchemas(plugin.manifest)),
							Effect.andThen(validatePluginExecutableScripts(plugin)),
						),
					{ discard: true },
				);
				yield* worker
					.validateDefinitionSet(
						kernel,
						plugins,
						changedPluginIds && { scope: "system", pluginIds: changedPluginIds },
					)
					.pipe(Effect.catchTag("CompilerWorkerUnavailable", Effect.die));
			});
			const inTransaction = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
				Effect.uninterruptible(
					database.transaction(repository.lockIngestion().pipe(Effect.andThen(effect))),
				).pipe(
					Effect.catchTag("DatabaseSessionStateError", () =>
						Effect.fail(new DbError({ message: "Plugin ingestion requires a root transaction" })),
					),
				);
			// The worker is leased before the ingestion lock, so a lock holder never waits for it.
			const withValidationWorker = <A, E, R>(
				use: (worker: PluginValidationSession) => Effect.Effect<A, E, R>,
			) => Effect.scoped(Effect.flatMap(validationWorker.session, use));
			const validateActiveSystemPlugins = Effect.fn(
				"PluginIngestionService.validateActiveSystemPlugins",
			)(<E, R>(changes: Effect.Effect<void, E, R>) =>
				withValidationWorker((worker) =>
					inTransaction(
						changes.pipe(
							Effect.andThen(repository.listActiveSystemPlugins()),
							Effect.flatMap((plugins) => validateSystemSet(worker, plugins)),
						),
					),
				),
			);
			const prepareSource = Effect.fn("PluginIngestionService.prepareSource")(function* (
				worker: PluginValidationSession,
				source: PluginSource,
			) {
				const manifest = yield* decodePluginManifest(source.manifest);
				const contentHash = yield* worker
					.checkSource(source)
					.pipe(Effect.catchTag("CompilerWorkerUnavailable", Effect.die));
				return checkedPluginSource(manifest, source, contentHash);
			});

			const ingestSystemPluginUnlocked = Effect.fn(
				"PluginIngestionService.ingestSystemPluginUnlocked",
			)(function* (
				worker: PluginValidationSession,
				normalizedSource: Effect.Success<ReturnType<typeof prepareSource>>,
				environmentResolution: EnvironmentResolutionTiming,
				target?: { readonly pluginId: string; readonly expectedContentHash: string },
				createOnly = false,
			) {
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
							if (environmentResolution === "immediate") {
								yield* repository.resolveEnvironmentConfig(authoritative);
							}
							yield* invalidator.all;
							const quarantined = yield* quarantinePackageConflicts(
								installations,
								invalidator,
								packageId,
							);
							return { quarantined, authoritative };
						}),
					);
					if (committed) {
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
						yield* validateSystemSet(worker, plugins, new Set([pluginId]));
						const entry = plugins.find((plugin) => plugin.id === pluginId);
						if (!entry) {
							return yield* new PluginValidationError({
								issues: [`System plugin ${packageId} is not active after ingestion`],
							});
						}
						if (environmentResolution === "immediate") {
							yield* repository.resolveEnvironmentConfig(entry);
						}
						yield* invalidator.all;
						const quarantined = yield* quarantinePackageConflicts(
							installations,
							invalidator,
							packageId,
						);
						return { entry, quarantined };
					}),
				);
				yield* retireQuarantinedInstallations(retirement, stored.quarantined);
				return stored.entry;
			});
			const ingestSystemPluginSource = (
				source: PluginSource,
				environmentResolution: EnvironmentResolutionTiming,
			) =>
				withValidationWorker((worker) =>
					prepareSource(worker, source).pipe(
						Effect.flatMap((prepared) =>
							ingestSystemPluginUnlocked(worker, prepared, environmentResolution),
						),
					),
				).pipe(structurePluginFailure);
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
				const installed = yield* withValidationWorker((worker) =>
					Effect.gen(function* () {
						const prepared = yield* prepareSource(worker, source);
						const packageId = prepared.manifest.metadata.packageId;
						if (yield* repository.findActiveSystemPluginByPackageId(packageId)) {
							return yield* new PluginConflictError({
								reason: { packageId, code: "already-installed" },
							});
						}
						return yield* ingestSystemPluginUnlocked(
							worker,
							prepared,
							"immediate",
							undefined,
							true,
						);
					}),
				).pipe(structurePluginFailure);
				return { pluginId: PluginId.make(installed.id) };
			});
			const updatePlugin = Effect.fn("PluginIngestionService.updatePlugin")(function* (
				input: PluginSource & { readonly pluginId: string; readonly contentHash: string },
			) {
				const installed = yield* withValidationWorker((worker) =>
					prepareSource(worker, input).pipe(
						Effect.flatMap((prepared) =>
							ingestSystemPluginUnlocked(worker, prepared, "immediate", {
								pluginId: input.pluginId,
								expectedContentHash: input.contentHash,
							}),
						),
					),
				).pipe(structurePluginFailure);
				return { pluginId: PluginId.make(installed.id) };
			});

			const uninstallPlugin = Effect.fn("PluginIngestionService.uninstallPlugin")(function* (
				pluginId: string,
				activationId: string,
			) {
				const localPluginId = PluginId.make(pluginId);
				const removed = yield* withValidationWorker((worker) =>
					inTransaction(
						Effect.gen(function* () {
							const receipt = yield* repository.findUninstalledActivation(activationId);
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
								worker,
								installed.filter((candidate) => candidate.id !== pluginId),
								new Set(),
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
							yield* invalidator.all;
							return plugin.id;
						}),
					),
				);
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
