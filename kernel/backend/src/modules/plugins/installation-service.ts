import { DbError } from "@ryot-app/contract/errors";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import {
	PluginConflictError,
	type PluginHomeViewSelection,
	PluginNotFoundError,
	PluginRequestError,
	type UpdatePrivatePluginBody,
	type UpdatePluginInstallationBody,
} from "@ryot-app/contract/modules/plugins/schemas";
import { KernelSavedViewRendererName } from "@ryot-app/contract/modules/saved-views/schemas";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { PluginId, UserId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { readPluginArchiveStream, type PluginArchivePackage } from "@ryot-app/plugin-archive";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Context, Effect, Layer, Result, Schema } from "effect";

import { DatabaseSession } from "#lib/infrastructure/db/session";
import {
	formatPropertyIssues,
	parseAppSchemaProperties,
} from "#lib/property-schema/property-schema-runtime";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import {
	buildDefinitionSnapshot,
	definitionSourceFromSnapshot,
} from "#modules/definition-registry/snapshot";
import { mergeManifestDefinitions } from "#modules/definition-registry/source";
import { MutationReceipts } from "#modules/mutations/receipts";
import { UploadIntentsService } from "#modules/uploads/intents/service";
import { ObjectStorageService } from "#modules/uploads/object-storage/service";

import { PluginCatalogInvalidator } from "./catalog-events";
import { PluginIngestionLock } from "./ingestion-lock";
import { PluginIngestionRetirement } from "./ingestion-retirement";
import {
	PluginInstallationRepository,
	type PluginInstallationRow,
} from "./installation-repository";
import { PluginInstallationLifecycleDispatcher } from "./installation-workflow";
import { normalizePluginPackage, normalizePluginSource, structurePluginFailure } from "./pipeline";
import { PluginRepository } from "./repository";
import { PluginSavedViewReferences } from "./saved-view-references";
import { validateAdditiveSchemaEvolution } from "./schema-evolution";
import { SystemPlugins } from "./system";
import type { NormalizedPlugin, StoredPlugin } from "./types";
import { resolvePluginUserSettings } from "./user-settings";
import {
	PluginValidationError,
	validatePluginExecutableScripts,
	validatePluginManifestPolicy,
	validatePluginManifestReferences,
	validatePluginScriptEntries,
} from "./validation";

type PrivatePluginPackageInput = PluginArchivePackage | { readonly uploadToken: string };

type InstallPrivatePluginInput = PrivatePluginPackageInput & {
	readonly userId: UserId;
	readonly config: Record<string, unknown>;
};

type DecodedInstallPrivatePluginInput = PluginArchivePackage & {
	readonly userId: UserId;
	readonly config: Record<string, unknown>;
};

type UpdatePrivatePluginInput = PrivatePluginPackageInput &
	Omit<UpdatePrivatePluginBody, "uploadToken"> & {
		readonly userId: UserId;
		readonly installationId: string;
	};

type HomeSavedViewTarget = NonNullable<
	Effect.Success<ReturnType<PluginInstallationRepository["Service"]["findHomeSavedView"]>>
>;

const isUsableHomeSavedView = (
	target: HomeSavedViewTarget,
	pluginsById: ReadonlyMap<string, Pick<StoredPlugin, "manifest">>,
) => {
	if (target.view.isHidden) {
		return false;
	}
	if (target.view.renderer.kind === "kernel") {
		return Schema.is(KernelSavedViewRendererName)(target.view.renderer.name);
	}
	return (
		pluginsById.get(target.view.renderer.pluginId)?.manifest.client?.exports?.[
			target.view.renderer.exportName
		]?.kind === "page"
	);
};

const buildEffectiveDefinitions = (
	systemDefinitions: Parameters<typeof definitionSourceFromSnapshot>[0],
	plugins: ReadonlyArray<{
		readonly id: string;
		readonly slug: string;
		readonly manifest: PluginManifest;
	}>,
) =>
	Effect.try({
		catch: (error) =>
			new PluginValidationError({
				issues: [error instanceof Error ? error.message : String(error)],
			}),
		try: () =>
			buildDefinitionSnapshot(
				mergeManifestDefinitions(definitionSourceFromSnapshot(systemDefinitions), plugins),
			),
	});

export class PluginInstallationService extends Context.Service<PluginInstallationService>()(
	"PluginInstallationService",
	{
		make: Effect.gen(function* () {
			const database = yield* DatabaseSession;
			const receipts = yield* MutationReceipts.make;
			const repository = yield* PluginRepository;
			const definitions = yield* DefinitionRepository;
			const ingestionLock = yield* PluginIngestionLock;
			const ingestionRetirement = yield* PluginIngestionRetirement;
			const uploadIntents = yield* UploadIntentsService;
			const objectStorage = yield* ObjectStorageService;
			const invalidator = yield* PluginCatalogInvalidator;
			const transaction = <A, E, R>(userId: UserId, work: Effect.Effect<A, E, R>) =>
				database
					.transaction(work.pipe(Effect.tap(() => invalidator.recordUser(userId))))
					.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
			const installations = yield* PluginInstallationRepository;
			const savedViewReferences = yield* PluginSavedViewReferences;
			const lifecycleDispatcher = yield* PluginInstallationLifecycleDispatcher;
			const bundled = yield* SystemPlugins;
			const assertPackageAvailable = Effect.fn("PluginInstallationService.assertPackageAvailable")(
				function* (manifest: PluginManifest, pluginId?: PluginId) {
					if (
						bundled.packageIds.has(manifest.metadata.packageId) ||
						(yield* repository.findActiveSystemPluginByPackageId(manifest.metadata.packageId))
					) {
						if (pluginId) {
							return yield* new PluginConflictError({
								reason: {
									pluginId,
									code: "package-identity-conflict",
									packageId: manifest.metadata.packageId,
								},
							});
						}
						return yield* new PluginRequestError({
							reason: { code: "reserved-system-identity", packageId: manifest.metadata.packageId },
						});
					}
					return yield* Effect.void;
				},
			);
			const findOwnedInstallation = Effect.fn("PluginInstallationService.findOwnedInstallation")(
				function* (userId: UserId, installationId: string) {
					const state = yield* installations.findById(installationId);
					if (!state || state.userId !== userId) {
						return yield* new PluginNotFoundError({
							reason: { installationId, code: "installation-not-found" },
						});
					}
					const plugin =
						state.pluginScope === "system"
							? yield* repository.findActiveSystemPluginById(state.pluginId)
							: yield* repository.findPrivateByIdForUser(state.pluginId, userId);
					const installation = yield* installations.findByUserAndPlugin(userId, state.pluginId);
					if (!plugin || !installation || installation.id !== installationId) {
						return yield* new PluginNotFoundError({
							reason: { installationId, code: "installation-not-found" },
						});
					}
					return { plugin, installation };
				},
			);
			const validateClientDependencies = Effect.fn(
				"PluginInstallationService.validateClientDependencies",
			)(function* (plugin: NormalizedPlugin, userId: UserId) {
				const references = Object.values(plugin.manifest.client?.pluginDependencies ?? {});
				if (references.length === 0) {
					return yield* Effect.void;
				}
				const usable = new Set(
					(yield* installations.listForUser(userId))
						.filter((state) => state.health === "ready" && !state.isHidden)
						.map(({ pluginId }) => pluginId),
				);
				const system = yield* repository.listActiveSystemPlugins();
				const privatePlugins = yield* repository.listPrivateForUser(userId);
				for (const reference of references) {
					const target = (reference.scope === "system" ? system : privatePlugins).find(
						({ packageId }) => packageId === reference.packageId,
					);
					if (!target || !usable.has(target.id)) {
						return yield* new PluginValidationError({
							issues: [
								`Client dependency ${reference.scope}/${reference.packageId} is unavailable`,
							],
						});
					}
					for (const imported of plugin.compiledClient?.imports ?? []) {
						if (
							imported.reference.packageId === reference.packageId &&
							imported.reference.scope === reference.scope &&
							!Object.hasOwn(target.manifest.client?.exports ?? {}, imported.exportName)
						) {
							return yield* new PluginValidationError({
								issues: [
									`Client dependency ${reference.scope}/${reference.packageId} does not export ${imported.exportName}`,
								],
							});
						}
					}
				}
				return yield* Effect.void;
			});

			const withPrivatePluginPackage = <A, E, R>(
				input: PrivatePluginPackageInput,
				userId: UserId,
				consume: (pluginPackage: PluginArchivePackage) => Effect.Effect<A, E, R>,
			) => {
				if (!("uploadToken" in input)) {
					return consume(input);
				}
				const useClaimedUpload = Effect.fnUntraced(function* (
					claimed: Effect.Success<ReturnType<typeof uploadIntents.claimTemporaryUpload>>,
				) {
					const stream = yield* objectStorage.openObject(claimed.locator);
					const pluginPackage = yield* readPluginArchiveStream(stream);
					return yield* consume(pluginPackage);
				});
				return uploadIntents
					.claimTemporaryUpload(
						input.uploadToken,
						userId,
						`plugin-package:${sha256Hex(input.uploadToken)}`,
					)
					.pipe(
						Effect.flatMap((claimed) =>
							useClaimedUpload(claimed).pipe(
								Effect.ensuring(
									uploadIntents.deleteTemporaryUpload(claimed.intentId).pipe(Effect.ignore),
								),
							),
						),
					);
			};

			const validateConfigPatch = Effect.fn("PluginInstallationService.validateConfigPatch")(
				function* (
					manifest: PluginManifest,
					stored: Record<string, unknown>,
					payload: {
						config?: Record<string, unknown> | undefined;
						unsetConfigKeys?: ReadonlyArray<string> | undefined;
					},
				) {
					const merged = { ...stored, ...payload.config };
					for (const key of payload.unsetConfigKeys ?? []) {
						delete merged[key];
					}
					return yield* parseAppSchemaProperties({
						properties: merged,
						kind: "Plugin config",
						propertiesSchema: manifest.configSchema,
					}).pipe(
						Effect.mapError(
							(error) =>
								new PluginValidationError({
									issues: [`Plugin config is invalid: ${formatPropertyIssues(error.issues)}`],
								}),
						),
					);
				},
			);
			const savePrivateInstallation = Effect.fn("PluginInstallationService.savePrivateInstallation")(
				function* (
					userId: UserId,
					plugin: StoredPlugin,
					installation: PluginInstallationRow,
					values: Pick<Parameters<typeof installations.updateState>[0], "config" | "isHidden" | "sortOrder">,
				) {
					const state = yield* installations.updateState({ ...values, id: installation.id });
					if (!state) {
						return yield* new PluginNotFoundError({ reason: { pluginId: PluginId.make(plugin.id), code: "plugin-not-found" } });
					}
					if (installation.health !== "incompatible") return { id: state.id, lifecycle: null };
					const activationId = installation.isInitialized
						? plugin.activationId
						: yield* repository.rotatePrivateActivation({ pluginId: plugin.id, ownerId: userId, expectedActivationId: plugin.activationId });
					yield* installations.updateHealth({ id: installation.id, health: installation.isInitialized ? "ready" : "installing", healthReason: null });
					return { id: state.id, lifecycle: installation.isInitialized ? null : { installationId: state.id, activationId } };
				},
			);
			const dispatchRecoveryLifecycle = Effect.fn("PluginInstallationService.dispatchRecoveryLifecycle")(
				(input: NonNullable<Effect.Success<ReturnType<typeof savePrivateInstallation>>["lifecycle"]>) =>
					lifecycleDispatcher.dispatch(input).pipe(Effect.catchCause((cause) => Effect.logError("plugin initialization recovery dispatch failed", cause))),
			);
			const validateRetainedRecovery = Effect.fn("PluginInstallationService.validateRetainedRecovery")(
				function* (userId: UserId, selected: Effect.Success<ReturnType<typeof findOwnedInstallation>>) {
					const { plugin } = selected;
					const pluginId = PluginId.make(plugin.id);
					yield* assertPackageAvailable(plugin.manifest, pluginId);
					const artifacts = yield* repository.listCompiledPackageArtifacts(plugin.id);
					const source = yield* normalizePluginSource({ manifest: plugin.manifest, ...artifacts });
					if (source.sourceHash !== plugin.sourceHash) {
						return yield* new PluginConflictError({ reason: { pluginId, code: "source-revision-stale" } });
					}
					const normalized = normalizePluginPackage(source);
					yield* validatePluginManifestPolicy(normalized.manifest, { scope: "user", systemPackageIds: bundled.packageIds });
					yield* validatePluginScriptEntries(normalized.manifest);
					yield* buildEffectiveDefinitions(yield* definitions.getGlobalSnapshot, [
						...(yield* repository.listPrivateForUser(userId)).filter((candidate) => candidate.id !== plugin.id),
						{ id: plugin.id, slug: plugin.slug, manifest: normalized.manifest },
					]);
					yield* validatePluginManifestReferences(normalized.manifest);
					yield* validatePluginExecutableScripts(normalized);
					return normalized;
				},
			);

			const provisionSystemInstallations = Effect.fn(
				"PluginInstallationService.provisionSystemInstallations",
			)((accountGeneration: AccountGeneration) =>
				database
					.transaction(
						receipts
							.admitAccount(accountGeneration)
							.pipe(
								Effect.andThen(
									installations.provisionSystemInstallationsForUser(accountGeneration.userId),
								),
							),
					)
					.pipe(
						Effect.catchTag(
							"DatabaseSessionStateError",
							() => new DbError({ message: "Plugin provisioning requires a root transaction" }),
						),
					),
			);

			const reconcilePrivateConflicts = Effect.fn(
				"PluginInstallationService.reconcilePrivateConflicts",
			)(function* () {
				const quarantined = yield* database.transaction(
					Effect.gen(function* () {
						yield* repository.lockIngestion();
						const conflicts = [];
						for (const plugin of yield* repository.listActiveSystemPlugins()) {
							conflicts.push(
								...(yield* installations.quarantinePackageIdentityConflicts(plugin.packageId)),
							);
						}
						for (const installation of conflicts) {
							yield* invalidator.recordUser(UserId.make(installation.userId));
						}
						return conflicts;
					}),
				);
				for (const installation of quarantined) {
					yield* invalidator.user(UserId.make(installation.userId));
					yield* ingestionRetirement.retire({
						pluginInstallationId: installation.id,
						userId: UserId.make(installation.userId),
						policy: {
							kind: "quarantine",
							reason: {
								installationId: installation.id,
								code: "package-identity-conflict",
								pluginId: PluginId.make(installation.pluginId),
							},
						},
					});
				}
			});

			const reconcileSystemInstallations = Effect.fn(
				"PluginInstallationService.reconcileSystemInstallations",
			)(function* () {
				yield* database.transaction(
					installations
						.provisionSystemInstallationsForAllUsers()
						.pipe(Effect.andThen(invalidator.recordAll)),
				);
				yield* reconcilePrivateConflicts();
				yield* invalidator.all;
			});

			const dispatchPendingInstallationLifecycle = Effect.fn(
				"PluginInstallationService.dispatchPendingInstallationLifecycle",
			)(function* () {
				const pending = yield* installations.listPendingLifecycle(100);
				yield* Effect.forEach(
					pending,
					(installation) =>
						lifecycleDispatcher
							.dispatch(installation)
							.pipe(
								Effect.catchCause((cause) =>
									Effect.logError("plugin installation lifecycle sweep failed", cause).pipe(
										Effect.annotateLogs({ installationId: installation.installationId }),
									),
								),
							),
					{ discard: true, concurrency: 4 },
				);
			});

			const setHomeView = Effect.fn("PluginInstallationService.setHomeView")(function* (
				userId: UserId,
				installationId: string,
				payload: PluginHomeViewSelection,
			) {
				const { plugin, installation: state } = yield* findOwnedInstallation(
					userId,
					installationId,
				);
				const pluginId = PluginId.make(plugin.id);
				const updated = yield* transaction(
					userId,
					Effect.gen(function* () {
						yield* repository.lockIngestion();
						yield* findOwnedInstallation(userId, installationId);
						yield* database.acquireUserWriteLock(userId);
						const usablePluginIds = new Set(
							(yield* installations.listForUser(userId))
								.filter((candidate) => candidate.health === "ready" && !candidate.isHidden)
								.map((candidate) => candidate.pluginId),
						);
						const rendererPlugins = new Map(
							[
								...(yield* repository.listActiveSystemPlugins()),
								...(yield* repository.listPrivateForUser(userId)),
							]
								.filter((candidate) => usablePluginIds.has(candidate.id))
								.map((candidate) => [candidate.id, candidate]),
						);
						if (payload.savedView !== null) {
							const target = yield* installations.findHomeSavedView(userId, payload.savedView);
							if (!target) {
								return yield* new PluginRequestError({
									reason: { code: "home-view-not-found", reference: payload.savedView },
								});
							}
							if (target.view.isHidden) {
								return yield* new PluginRequestError({
									reason: { code: "home-view-hidden", reference: payload.savedView },
								});
							}
							if (!isUsableHomeSavedView(target, rendererPlugins)) {
								return yield* new PluginRequestError({
									reason: { reference: payload.savedView, code: "home-view-renderer-unavailable" },
								});
							}
						}
						return yield* installations.setHomeSavedView(userId, state.id, payload.savedView);
					}),
				);
				if (!updated) {
					return yield* new PluginNotFoundError({ reason: { pluginId, code: "plugin-not-found" } });
				}
				yield* invalidator.user(userId);
				return payload;
			});

			const dispatchInstallationLifecycle = Effect.fn(
				"PluginInstallationService.dispatchInstallationLifecycle",
			)(function* (state: PluginInstallationRow, activationId: string) {
				const dispatched = yield* Effect.result(
					lifecycleDispatcher.dispatch({ activationId, installationId: state.id }),
				);
				if (Result.isSuccess(dispatched)) {
					return state;
				}
				yield* Effect.logError("plugin installation lifecycle dispatch failed").pipe(
					Effect.annotateLogs({ installationId: state.id }),
				);
				return state;
			});

			const installPrivateUnlocked = Effect.fn("PluginInstallationService.installPrivateUnlocked")(
				function* (input: DecodedInstallPrivatePluginInput) {
					const normalizedSource = yield* normalizePluginSource(input);
					const { manifest } = normalizedSource;
					const slug = manifest.metadata.slug;
					const packageId = manifest.metadata.packageId;
					const systemPlugins = yield* repository.listActiveSystemPlugins();
					yield* validatePluginManifestPolicy(manifest, {
						scope: "user",
						systemPackageIds: new Set([
							...bundled.packageIds,
							...systemPlugins.map((plugin) => plugin.packageId),
						]),
					});
					yield* validatePluginScriptEntries(manifest);
					const owned = yield* repository.listPrivateForUser(input.userId);
					const claimed = yield* repository.findPrivateByPackageIdForUser(packageId, input.userId);
					if (claimed && claimed.status !== "inactive") {
						return yield* new PluginConflictError({
							reason: { packageId, code: "already-installed" },
						});
					}
					yield* buildEffectiveDefinitions(yield* definitions.getGlobalSnapshot, [
						...owned,
						{ slug, manifest, id: "private-plugin-candidate" },
					]);
					yield* validatePluginManifestReferences(manifest);
					const config = yield* parseAppSchemaProperties({
						kind: "Plugin config",
						properties: input.config,
						propertiesSchema: manifest.configSchema,
					}).pipe(
						Effect.mapError(
							(error) =>
								new PluginValidationError({
									issues: [`Plugin config is invalid: ${formatPropertyIssues(error.issues)}`],
								}),
						),
					);
					const normalized = normalizePluginPackage(normalizedSource);
					yield* validatePluginExecutableScripts(normalized);
					const installed = yield* Effect.uninterruptible(
						transaction(
							input.userId,
							Effect.gen(function* () {
								yield* repository.lockIngestion();
								yield* assertPackageAvailable(manifest);
								const currentClaim = yield* repository.findPrivateByPackageIdForUser(
									packageId,
									input.userId,
								);
								if (currentClaim && currentClaim.status !== "inactive") {
									return yield* new PluginConflictError({
										reason: { packageId, code: "already-installed" },
									});
								}
								yield* validateClientDependencies(normalized, input.userId);
								const pluginId = yield* ingestionLock.persistUserPlugin(normalized, {
									slug,
									packageId,
									scope: "user",
									ownerId: input.userId,
								});
								const existing = yield* installations.findByUserAndPlugin(input.userId, pluginId);
								const current = yield* installations.listForUser(input.userId);
								const sortOrder =
									existing?.sortOrder ??
									Math.max(
										systemPlugins.length - 1,
										...current.map(({ sortOrder: order }) => order),
									) + 1;
								const existingState = yield* installations.upsertState({
									config,
									pluginId,
									sortOrder,
									isHidden: false,
									health: "installing",
									userId: input.userId,
								});
								if (!existingState) {
									return yield* new DbError({
										message: "Plugin installation upsert returned no row",
									});
								}
								const active = yield* repository.findPrivateByIdForUser(pluginId, input.userId);
								if (!active) {
									return yield* new DbError({ message: "Installed plugin is not active" });
								}
								return { state: existingState, activationId: active.activationId };
							}),
						).pipe(Effect.tap(() => invalidator.user(input.userId))),
					);
					yield* dispatchInstallationLifecycle(installed.state, installed.activationId);
					return {
						id: installed.state.id,
						activationId: installed.activationId,
						pluginId: PluginId.make(installed.state.pluginId),
					};
				},
			);

			const installPrivatePlugin = Effect.fn("PluginInstallationService.installPrivatePlugin")(
				(input: InstallPrivatePluginInput) =>
					withPrivatePluginPackage(input, input.userId, (pluginPackage) =>
						installPrivateUnlocked({
							...pluginPackage,
							userId: input.userId,
							config: input.config,
						}),
					).pipe(structurePluginFailure),
			);

			const updatePrivateUnlocked = Effect.fn("PluginInstallationService.updatePrivateUnlocked")(
				function* (input: UpdatePrivatePluginInput) {
					const { plugin, installation } = yield* findOwnedInstallation(
						input.userId,
						input.installationId,
					);
					const pluginId = PluginId.make(plugin.id);
					if (plugin.scope === "system") {
						return yield* new PluginConflictError({ reason: { pluginId, code: "system-plugin" } });
					}
					return yield* withPrivatePluginPackage(input, input.userId, (pluginPackage) =>
						Effect.gen(function* () {
							const normalizedSource = yield* normalizePluginSource(pluginPackage);
							const { manifest } = normalizedSource;
							if (manifest.metadata.packageId !== plugin.packageId) {
								return yield* new PluginRequestError({
									reason: {
										pluginId,
										code: "package-id-mismatch",
										expectedPackageId: plugin.packageId,
										packageId: manifest.metadata.packageId,
									},
								});
							}
							yield* assertPackageAvailable(manifest, pluginId);
							yield* validatePluginManifestPolicy(manifest, {
								scope: "user",
								systemPackageIds: new Set([
									...bundled.packageIds,
									...(yield* repository.listActiveSystemPlugins()).map(
										({ packageId }) => packageId,
									),
								]),
							});
							yield* validatePluginScriptEntries(manifest);
							yield* buildEffectiveDefinitions(yield* definitions.getGlobalSnapshot, [
								...(yield* repository.listPrivateForUser(input.userId)).filter(
									(candidate) => candidate.id !== plugin.id,
								),
								{ manifest, id: plugin.id, slug: plugin.slug },
							]);
							yield* validatePluginManifestReferences(manifest);
							yield* validateAdditiveSchemaEvolution(plugin.manifest, manifest);
							const normalized = normalizePluginPackage(normalizedSource);
							yield* validatePluginExecutableScripts(normalized);

							const updated = yield* Effect.uninterruptible(
								transaction(
									input.userId,
									Effect.gen(function* () {
										yield* repository.lockIngestion();
										yield* installations.assertIngestionActive(input.userId, installation.id);
										yield* assertPackageAvailable(manifest, pluginId);
										const current = yield* repository.findPrivateByIdForUser(
											plugin.id,
											input.userId,
										);
										const currentInstallation = yield* installations.findByUserAndPlugin(
											input.userId,
											plugin.id,
										);
										if (!current || currentInstallation?.id !== installation.id) {
											return yield* new PluginNotFoundError({
												reason: { pluginId, code: "plugin-not-found" },
											});
										}
										yield* validateAdditiveSchemaEvolution(current.manifest, manifest);
										const declarations = yield* repository.findReferencedRemovedDeclarations(
											current,
											manifest,
										);
										if (declarations.length > 0) {
											return yield* new PluginConflictError({
												reason: {
													pluginId,
													declarations,
													code: "referenced-definition-incompatible",
												},
											});
										}
										if (current.sourceHash !== input.sourceHash) {
											return yield* new PluginConflictError({
												reason: { pluginId, code: "source-revision-stale" },
											});
										}
										yield* validateClientDependencies(normalized, input.userId);
										if (
											currentInstallation.health === "incompatible" &&
											!currentInstallation.isInitialized &&
											normalized.sourceHash !== current.sourceHash
										) {
											return yield* new PluginValidationError({
												issues: ["Initialization recovery must use the retained package revision"],
											});
										}
										const configResult = yield* Effect.result(
											validateConfigPatch(manifest, currentInstallation.config, input),
										);
										if (
											currentInstallation.incompatibilityReason !== null &&
											Result.isFailure(configResult)
										) {
											return yield* configResult.failure;
										}
										const persistedId = yield* ingestionLock.persistUserPlugin(normalized, {
											scope: "user",
											pluginId: current.id,
											ownerId: input.userId,
											slug: manifest.metadata.slug,
											packageId: current.packageId,
										});
										if (persistedId !== current.id) {
											return yield* new PluginValidationError({
												issues: ["Plugin update did not retain its stable identity"],
											});
										}
										if (Result.isFailure(configResult)) {
											const healthReason =
												"Configuration does not match the active package revision";
											yield* installations.updateHealth({
												healthReason,
												id: currentInstallation.id,
												health: "needs-configuration",
											});
											return { id: currentInstallation.id };
										}
										return yield* savePrivateInstallation(input.userId, current, currentInstallation, {
											config: configResult.success,
											isHidden: currentInstallation.isHidden,
											sortOrder: currentInstallation.sortOrder,
										});
									}),
								).pipe(Effect.tap(() => invalidator.user(input.userId))),
							);
							if ("lifecycle" in updated && updated.lifecycle) {
								yield* dispatchRecoveryLifecycle(updated.lifecycle);
							}
							return { id: updated.id, pluginId: PluginId.make(plugin.id) };
						}),
					);
				},
			);

			const updatePrivatePlugin = Effect.fn("PluginInstallationService.updatePrivatePlugin")(
				(input: UpdatePrivatePluginInput) =>
					updatePrivateUnlocked(input).pipe(
						Effect.map((value) => ({ value, found: true as const })),
						Effect.catchTag("PluginNotFoundError", (error) =>
							Effect.succeed({ error, found: false as const }),
						),
						structurePluginFailure,
						Effect.flatMap((result) =>
							result.found ? Effect.succeed(result.value) : Effect.fail(result.error),
						),
					),
			);

			const updateInstallationUnlocked = Effect.fn(
				"PluginInstallationService.updateInstallationUnlocked",
			)(function* (userId: UserId, installationId: string, payload: UpdatePluginInstallationBody) {
				yield* repository.lockIngestion();
				const { plugin, installation: state } = yield* findOwnedInstallation(
					userId,
					installationId,
				);
				const pluginId = PluginId.make(plugin.id);
				if (
					plugin.scope === "system" &&
					(Object.hasOwn(payload, "config") || Object.hasOwn(payload, "unsetConfigKeys"))
				) {
					return yield* new PluginConflictError({ reason: { pluginId, code: "system-plugin" } });
				}
				const isHidden = payload.isHidden ?? state.isHidden;
				if (
					payload.isHidden === false &&
					state.health !== "ready" &&
					state.health !== "needs-configuration"
				) {
					return yield* new PluginConflictError({
						reason: { pluginId, health: state.health, code: "installation-not-ready" },
					});
				}
				const config =
					plugin.scope === "system"
						? {}
						: yield* validateConfigPatch(plugin.manifest, state.config, payload);
				const saved = yield* Effect.uninterruptible(
					installations.updateState({
						config,
						isHidden,
						id: state.id,
						sortOrder: payload.sortOrder ?? state.sortOrder,
					}),
				);
				if (!saved) {
					return yield* new PluginNotFoundError({ reason: { pluginId, code: "plugin-not-found" } });
				}
				return { id: saved.id, pluginId: PluginId.make(plugin.id) };
			});

			const updateInstallationPrepared = Effect.fn("PluginInstallationService.updateInstallationPrepared")(
				function* (userId: UserId, installationId: string, payload: UpdatePluginInstallationBody) {
					const selected = yield* findOwnedInstallation(userId, installationId);
					const { plugin, installation } = selected;
					if (payload.isHidden !== false || plugin.scope !== "user" || installation.health !== "incompatible" || installation.incompatibilityReason !== "package-identity-conflict") {
						return yield* transaction(userId, updateInstallationUnlocked(userId, installationId, payload)).pipe(Effect.tap(() => invalidator.user(userId)));
					}
					const normalized = yield* validateRetainedRecovery(userId, selected);
					const config = yield* validateConfigPatch(normalized.manifest, installation.config, payload);
					const updated = yield* Effect.uninterruptible(transaction(userId, Effect.gen(function* () {
						yield* repository.lockIngestion();
						yield* installations.assertIngestionActive(userId, installationId);
						const current = yield* findOwnedInstallation(userId, installationId);
						const pluginId = PluginId.make(plugin.id);
						yield* assertPackageAvailable(current.plugin.manifest, pluginId);
						if (
							current.plugin.id !== plugin.id || current.plugin.scope !== "user" || current.plugin.packageId !== plugin.packageId ||
							current.plugin.sourceHash !== plugin.sourceHash || current.plugin.activationId !== plugin.activationId ||
							current.installation.activeConfigRevisionId !== installation.activeConfigRevisionId ||
							current.installation.health !== installation.health || current.installation.incompatibilityReason !== installation.incompatibilityReason ||
							current.installation.isInitialized !== installation.isInitialized ||
							current.installation.isHidden !== installation.isHidden || current.installation.sortOrder !== installation.sortOrder ||
							current.installation.updatedAt.getTime() !== installation.updatedAt.getTime() ||
							!(yield* repository.isActiveRevision({ pluginId: plugin.id, sourceHash: normalized.sourceHash }))
						) {
							return yield* new PluginConflictError({ reason: { pluginId, code: "source-revision-stale" } });
						}
						yield* validateClientDependencies(normalized, userId);
						return yield* savePrivateInstallation(userId, current.plugin, current.installation, { config, isHidden: false, sortOrder: payload.sortOrder ?? current.installation.sortOrder });
					})));
					yield* invalidator.user(userId);
					if (updated.lifecycle) yield* dispatchRecoveryLifecycle(updated.lifecycle);
					return { id: updated.id, pluginId: PluginId.make(plugin.id) };
				},
			);
			const updateInstallation = Effect.fn("PluginInstallationService.updateInstallation")(
				(userId: UserId, installationId: string, payload: UpdatePluginInstallationBody) =>
					updateInstallationPrepared(userId, installationId, payload).pipe(
						Effect.map((value) => ({ value, found: true as const })),
						Effect.catchTag("PluginNotFoundError", (error) => Effect.succeed({ error, found: false as const })),
						structurePluginFailure,
						Effect.flatMap((result) => result.found ? Effect.succeed(result.value) : Effect.fail(result.error)),
					),
			);

			const assertUnreferenced = Effect.fn("PluginInstallationService.assertUnreferenced")(
				function* (plugin: StoredPlugin, installation: PluginInstallationRow, pluginId: PluginId) {
					if (
						yield* repository.hasIntegrationReferences({
							pluginId: plugin.id,
							pluginInstallationId: installation.id,
						})
					) {
						return yield* new PluginConflictError({
							reason: { pluginId, code: "integration-referenced" },
						});
					}
					const entitySchemaSlugs = plugin.manifest.entitySchemas.map(({ slug }) => slug);
					if (yield* repository.hasEntityReferences({ entitySchemaSlugs, pluginId: plugin.id })) {
						return yield* new PluginConflictError({
							reason: { pluginId, code: "entity-referenced" },
						});
					}
					if (yield* repository.hasDefinitionReferences(plugin.id)) {
						return yield* new PluginConflictError({
							reason: { pluginId, code: "entity-referenced" },
						});
					}
					if (
						yield* savedViewReferences.hasCustomSavedViewReferences(
							UserId.make(installation.userId),
							installation.id,
						)
					) {
						return yield* new PluginConflictError({
							reason: { pluginId, code: "saved-view-referenced" },
						});
					}
					return yield* Effect.void;
				},
			);

			const uninstallPlugin = Effect.fn("PluginInstallationService.uninstallPlugin")(function* (
				userId: UserId,
				installationId: string,
				activationId: string,
			) {
				const removed = yield* Effect.uninterruptible(
					database
						.transaction(
							Effect.gen(function* () {
								yield* repository.lockIngestion();
								const receipt = yield* repository.findUninstallReceipt(activationId);
								yield* database.acquireUserWriteLock(userId);
								if (receipt?.ownerId === userId && receipt.installationId === installationId) {
									return {
										replayed: true,
										result: {
											id: receipt.installationId,
											pluginId: PluginId.make(receipt.pluginId),
										},
									};
								}
								const { plugin, installation } = yield* findOwnedInstallation(
									userId,
									installationId,
								);
								if (plugin.scope === "system") {
									return yield* new PluginConflictError({
										reason: { code: "system-plugin", pluginId: PluginId.make(plugin.id) },
									});
								}
								if (plugin.activationId !== activationId) {
									return yield* new PluginNotFoundError({
										reason: { code: "plugin-not-found", pluginId: PluginId.make(plugin.id) },
									});
								}
								const current = yield* repository.findPrivateByIdForUser(plugin.id, userId);
								const currentInstallation = yield* installations.findByUserAndPlugin(
									userId,
									plugin.id,
								);
								if (
									!current ||
									current.activationId !== activationId ||
									currentInstallation?.id !== installation.id
								) {
									return yield* new PluginNotFoundError({
										reason: { code: "plugin-not-found", pluginId: PluginId.make(plugin.id) },
									});
								}
								yield* assertUnreferenced(current, currentInstallation, PluginId.make(current.id));
								yield* installations.beginIngestionRetirement(userId, currentInstallation.id);
								return {
									replayed: false,
									result: { id: installation.id, pluginId: PluginId.make(plugin.id) },
								};
							}),
						)
						.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die)),
				);
				if (!removed.replayed) {
					yield* ingestionRetirement.retire({
						userId,
						policy: { kind: "removal" },
						pluginInstallationId: removed.result.id,
					});
					yield* database
						.transaction(
							Effect.gen(function* () {
								yield* repository.lockIngestion();
								yield* database.acquireUserWriteLock(userId);
								const current = yield* repository.findPrivateByIdForUser(
									removed.result.pluginId,
									userId,
								);
								const receipt = yield* repository.findUninstallReceipt(activationId);
								if (
									receipt?.ownerId === userId &&
									receipt.installationId === removed.result.id &&
									receipt.pluginId === removed.result.pluginId
								) {
									return yield* Effect.void;
								}
								if (!current || current.activationId !== activationId) {
									return yield* new PluginNotFoundError({
										reason: { code: "plugin-not-found", pluginId: removed.result.pluginId },
									});
								}
								yield* installations.remove(removed.result.id);
								yield* repository.deactivate(current.id);
								yield* repository.recordUninstallReceipt({
									activationId,
									ownerId: userId,
									slug: current.slug,
									pluginId: current.id,
									installationId: removed.result.id,
								});
								yield* invalidator.recordUser(userId);
								return yield* Effect.void;
							}),
						)
						.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
					yield* invalidator.user(userId);
				}
				return removed.result;
			});

			const saveUserSettings = Effect.fn("PluginInstallationService.saveUserSettings")(
				(
					userId: UserId,
					installationId: string,
					values: Record<string, JsonValue>,
					reset = false,
				) =>
					transaction(
						userId,
						Effect.gen(function* () {
							yield* repository.lockIngestion();
							const row = yield* installations.findUserSettings(userId, installationId);
							if (!row?.manifest.userSettingsSchema) {
								return yield* new PluginNotFoundError({
									reason: { installationId, code: "installation-not-found" },
								});
							}
							yield* resolvePluginUserSettings(
								row.manifest.userSettingsSchema,
								reset ? {} : values,
							).pipe(
								Effect.catchTags({
									SchemaError: Effect.die,
									PropertyValidationError: (error) =>
										new PluginRequestError({
											reason: {
												code: "validation-failed",
												diagnostics: error.issues.map((issue) => ({
													message: issue.message,
													phase: "validate" as const,
													severity: "error" as const,
													code: "invalid-user-settings",
												})),
											},
										}),
								}),
							);
							return yield* installations.saveUserSettings(
								userId,
								installationId,
								reset ? {} : values,
							);
						}),
					).pipe(Effect.tap(() => invalidator.user(userId))),
			);

			return {
				setHomeView,
				uninstallPlugin,
				saveUserSettings,
				updateInstallation,
				updatePrivatePlugin,
				installPrivatePlugin,
				provisionSystemInstallations,
				reconcileSystemInstallations,
				dispatchPendingInstallationLifecycle,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
	static readonly layerRuntime = Layer.effect(this, this.make);
	static readonly layerMigration = Layer.effect(this, this.make);
}
