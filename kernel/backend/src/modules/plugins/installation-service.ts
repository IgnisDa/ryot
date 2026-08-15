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
import { PluginId, PluginSlug, UserId } from "@ryot-app/contract/schema/brands";
import { readPluginArchiveStream, type PluginArchivePackage } from "@ryot-app/plugin-archive";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Context, Effect, Layer, Result, Schema } from "effect";

import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import {
	formatPropertyIssues,
	parseAppSchemaProperties,
} from "#lib/property-schema/property-schema-runtime";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import {
	buildDefinitionSnapshot,
	definitionSourceFromSnapshot,
	type DefinitionSnapshot,
} from "#modules/definition-registry/snapshot";
import { mergeManifestDefinitions } from "#modules/definition-registry/source";
import { ClientPluginCompiler } from "#modules/plugins/client-plugin-compiler";
import { UploadIntentsService } from "#modules/uploads/intents/service";
import { ObjectStorageService } from "#modules/uploads/object-storage/service";

import { PluginCatalogInvalidator } from "./catalog-events";
import { PluginDefinitionMaterializer } from "./definition-materializer";
import { PluginIngestionLock } from "./ingestion-lock";
import {
	PluginInstallationRepository,
	type PluginInstallationRow,
	type PluginPrivateInstallationRow,
} from "./installation-repository";
import { PluginInstallationLifecycleDispatcher } from "./installation-workflow";
import { compilePluginPackage, normalizePluginSource, structurePluginFailure } from "./pipeline";
import { PluginRepository } from "./repository";
import { validateAdditiveSchemaEvolution } from "./schema-evolution";
import type { StoredPlugin } from "./types";
import {
	PluginValidationError,
	validatePluginExecutableScripts,
	validatePluginManifestPolicy,
	validatePluginManifestReferences,
	validatePluginSourcePaths,
	validatePluginPackageLimits,
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
		readonly pluginSlug: string;
	};

type HomeSavedViewTarget = NonNullable<
	Effect.Success<ReturnType<PluginInstallationRepository["Service"]["lockHomeSavedView"]>>
>;

const isUsableHomeSavedView = (
	userId: UserId,
	target: HomeSavedViewTarget,
	pluginsById: ReadonlyMap<string, Pick<StoredPlugin, "manifest">>,
) => {
	if (target.view.isDisabled) {
		return false;
	}
	if (target.view.renderer.kind === "kernel") {
		return Schema.is(KernelSavedViewRendererName)(target.view.renderer.name);
	}
	if (target.view.renderer.kind === "plugin") {
		return (
			pluginsById.get(target.view.renderer.pluginId)?.manifest.client?.exports?.[
				target.view.renderer.exportName
			]?.kind === "page"
		);
	}
	return (
		target.renderer?.userId === userId &&
		target.renderer.publishedHash !== null &&
		target.renderer.publishedRevision !== null &&
		target.renderer.publishedDefinition !== null
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

const validateEffectiveSurfaceSlugs = (
	plugins: ReadonlyArray<{ readonly slug: string; readonly manifest: PluginManifest }>,
) =>
	Effect.try({
		catch: (error) =>
			new PluginValidationError({
				issues: [error instanceof Error ? error.message : String(error)],
			}),
		try: () => {
			const owners = {
				provider: new Map<string, string>(),
				"import source": new Map<string, string>(),
				"integration provider": new Map<string, string>(),
			};
			const claim = (kind: keyof typeof owners, slug: string, pluginSlug: string) => {
				const owner = owners[kind].get(slug);
				if (owner) {
					throw new Error(
						`Duplicate ${kind} slug '${slug}' in effective plugins '${owner}' and '${pluginSlug}'`,
					);
				}
				owners[kind].set(slug, pluginSlug);
			};
			for (const plugin of plugins) {
				for (const provider of plugin.manifest.providers) {
					claim("provider", provider.slug, plugin.slug);
				}
				for (const source of plugin.manifest.importSources) {
					claim("import source", source.slug, plugin.slug);
				}
				for (const provider of plugin.manifest.integrationProviders) {
					claim("integration provider", provider.slug, plugin.slug);
				}
			}
		},
	});

const definitionClaimKinds = [
	["savedViews", "saved view"],
	["entitySchemas", "entity schema"],
	["signalSchemas", "signal schema"],
	["relationshipSchemas", "relationship schema"],
] as const;

const shippedConflictReason = (issue: string) =>
	`Conflicts with the shipped plugin set: ${issue}`.slice(0, 240);

const findShippedDefinitionClaim = (
	manifest: PluginManifest,
	systemDefinitions: DefinitionSnapshot,
) => {
	for (const [field, kind] of definitionClaimKinds) {
		for (const { slug } of manifest[field]) {
			if (Object.hasOwn(systemDefinitions[field], slug)) {
				return `Shipped plugins already define the ${kind} '${slug}'`;
			}
		}
	}
	return null;
};

const detectShippedConflict = (
	plugin: { readonly pluginSlug: string; readonly manifest: PluginManifest },
	shipped: {
		readonly systemSlugs: ReadonlySet<string>;
		readonly systemDefinitions: DefinitionSnapshot;
		readonly systemPlugins: ReadonlyArray<{
			readonly slug: string;
			readonly manifest: PluginManifest;
		}>;
	},
) =>
	Effect.gen(function* () {
		yield* validatePluginManifestPolicy(plugin.manifest, {
			scope: "user",
			systemSlugs: shipped.systemSlugs,
		});
		yield* validateEffectiveSurfaceSlugs([
			...shipped.systemPlugins,
			{ slug: plugin.pluginSlug, manifest: plugin.manifest },
		]);
		const claimed = findShippedDefinitionClaim(plugin.manifest, shipped.systemDefinitions);
		return claimed === null ? null : yield* new PluginValidationError({ issues: [claimed] });
	}).pipe(
		Effect.catchTags({
			PluginValidationError: (error) =>
				Effect.succeed(error.issues[0] ?? "Shipped plugin definitions conflict"),
			PluginSlugReservedError: () =>
				Effect.succeed(`Shipped plugins already use the slug '${plugin.pluginSlug}'`),
		}),
	);

export class PluginInstallationService extends Context.Service<PluginInstallationService>()(
	"PluginInstallationService",
	{
		make: Effect.gen(function* () {
			const database = yield* Database;
			const repository = yield* PluginRepository;
			const definitions = yield* DefinitionRepository;
			const ingestionLock = yield* PluginIngestionLock;
			const uploadIntents = yield* UploadIntentsService;
			const clientCompiler = yield* ClientPluginCompiler;
			const objectStorage = yield* ObjectStorageService;
			const invalidator = yield* PluginCatalogInvalidator;
			const installations = yield* PluginInstallationRepository;
			const definitionMaterializer = yield* PluginDefinitionMaterializer;
			const lifecycleDispatcher = yield* PluginInstallationLifecycleDispatcher;

			const withPrivatePluginPackage = <A, E, R>(
				input: PrivatePluginPackageInput,
				userId: UserId,
				consume: (pluginPackage: PluginArchivePackage) => Effect.Effect<A, E, R>,
			) => {
				if (!("uploadToken" in input)) {
					return consume(input);
				}
				return Effect.gen(function* () {
					const claimed = yield* uploadIntents.claimTemporaryUpload(
						input.uploadToken,
						userId,
						`plugin-package:${sha256Hex(input.uploadToken)}`,
					);
					return yield* Effect.gen(function* () {
						const stream = yield* objectStorage.openObject(claimed.locator);
						const pluginPackage = yield* readPluginArchiveStream(stream);
						return yield* consume(pluginPackage);
					}).pipe(
						Effect.ensuring(
							uploadIntents.deleteTemporaryUpload(claimed.intentId).pipe(Effect.ignore),
						),
					);
				});
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

			const provisionSystemInstallations = Effect.fn(
				"PluginInstallationService.provisionSystemInstallations",
			)((userId: UserId) => installations.provisionSystemInstallationsForUser(userId));

			const reconcilePrivateConflicts = Effect.fn(
				"PluginInstallationService.reconcilePrivateConflicts",
			)(function* () {
				const rows = yield* installations.listPrivateInstallations();
				const systemDefinitions = yield* definitions.getGlobalSnapshot;
				const systemPlugins = yield* repository.listActiveSystemPlugins();
				const systemSlugs = new Set(systemPlugins.map(({ slug }) => slug));
				const owners = new Map<UserId, Array<PluginPrivateInstallationRow>>();
				for (const row of rows) {
					const userId = UserId.make(row.userId);
					const owned = owners.get(userId);
					if (owned) {
						owned.push(row);
					} else {
						owners.set(userId, [row]);
					}
				}
				for (const [userId, owned] of owners) {
					const conflicts = new Map<string, string>();
					const survivors: Array<PluginPrivateInstallationRow> = [];
					for (const row of owned) {
						const issue = yield* detectShippedConflict(row, {
							systemSlugs,
							systemPlugins,
							systemDefinitions,
						});
						if (issue === null) {
							survivors.push(row);
						} else {
							conflicts.set(row.installationId, issue);
						}
					}
					const effective = yield* buildEffectiveDefinitions(
						systemDefinitions,
						survivors.map(({ manifest, pluginId, pluginSlug }) => ({
							manifest,
							id: pluginId,
							slug: pluginSlug,
						})),
					).pipe(Effect.catchTag("PluginValidationError", () => Effect.succeed(null)));
					if (effective === null) {
						yield* Effect.logWarning(
							"private plugin effective definitions could not be composed",
						).pipe(Effect.annotateLogs({ userId }));
					} else {
						for (const row of survivors) {
							const issue = yield* validatePluginManifestReferences(row.manifest, effective).pipe(
								Effect.as(null),
								Effect.catchTag("PluginValidationError", (error) =>
									Effect.succeed(error.issues[0] ?? "Shipped plugin definitions conflict"),
								),
							);
							if (issue !== null) {
								conflicts.set(row.installationId, issue);
							}
						}
					}
					let healthChanged = false;
					for (const row of owned) {
						const issue = conflicts.get(row.installationId);
						if (issue === undefined) {
							if (row.health === "incompatible") {
								yield* installations.updateHealth({
									health: "ready",
									healthReason: null,
									id: row.installationId,
								});
								healthChanged = true;
							}
							continue;
						}
						yield* definitionMaterializer.removeGenerated(row.installationId);
						if (row.health !== "ready" && row.health !== "incompatible") {
							continue;
						}
						const healthReason = shippedConflictReason(issue);
						if (row.health === "incompatible" && row.healthReason === healthReason) {
							continue;
						}
						yield* installations.updateHealth({
							healthReason,
							health: "incompatible",
							id: row.installationId,
						});
						healthChanged = true;
					}
					if (healthChanged) {
						yield* definitionMaterializer.materialize(userId);
						yield* invalidator.user(userId);
					}
				}
			});

			const reconcileSystemInstallations = Effect.fn(
				"PluginInstallationService.reconcileSystemInstallations",
			)(function* () {
				yield* installations.provisionSystemInstallationsForAllUsers();
				yield* reconcilePrivateConflicts();
				yield* invalidator.all;
			});

			const dispatchPendingInstallationLifecycle = Effect.fn(
				"PluginInstallationService.dispatchPendingInstallationLifecycle",
			)(function* () {
				const pending = yield* installations.listPendingLifecycle();
				yield* Effect.forEach(
					pending,
					(installationId) =>
						lifecycleDispatcher
							.dispatch(installationId)
							.pipe(
								Effect.catchCause((cause) =>
									Effect.logError("plugin installation lifecycle sweep failed", cause).pipe(
										Effect.annotateLogs({ installationId }),
									),
								),
							),
					{ discard: true, concurrency: 4 },
				);
			});

			const setHomeView = Effect.fn("PluginInstallationService.setHomeView")(function* (
				userId: UserId,
				slug: string,
				payload: PluginHomeViewSelection,
			) {
				const pluginSlug = PluginSlug.make(slug);
				const systemPlugin = yield* repository.findActiveSystemPlugin(slug);
				const privatePlugin = systemPlugin
					? undefined
					: (yield* repository.listPrivateForUser(userId)).find(
							(candidate) => candidate.slug === slug,
						);
				const plugin = systemPlugin ?? privatePlugin;
				const state = plugin ? yield* installations.findByUserAndPlugin(userId, plugin.id) : null;
				if (!state) {
					return yield* new PluginNotFoundError({
						reason: { pluginSlug, code: "plugin-not-found" },
					});
				}
				const updated = yield* mapDatabaseErrors(
					database.transaction((transaction) =>
						Effect.gen(function* () {
							const usablePluginIds = new Set(
								(yield* installations.listForUser(userId))
									.filter((candidate) => candidate.health === "ready" && !candidate.isDisabled)
									.map(({ pluginId }) => pluginId),
							);
							const rendererPlugins = new Map(
								[
									...(yield* repository.listActiveSystemPlugins()),
									...(yield* repository.listPrivateForUser(userId)),
								]
									.filter((candidate) => usablePluginIds.has(candidate.id))
									.map((candidate) => [candidate.id, candidate]),
							);
							if (payload.savedViewId !== null) {
								const target = yield* installations.lockHomeSavedView(userId, payload.savedViewId);
								if (!target) {
									return yield* new PluginRequestError({
										reason: { code: "home-view-not-found", savedViewId: payload.savedViewId },
									});
								}
								if (target.view.isDisabled) {
									return yield* new PluginRequestError({
										reason: { code: "home-view-disabled", savedViewId: payload.savedViewId },
									});
								}
								if (!isUsableHomeSavedView(userId, target, rendererPlugins)) {
									return yield* new PluginRequestError({
										reason: {
											savedViewId: payload.savedViewId,
											code: "home-view-renderer-unavailable",
										},
									});
								}
							}
							return yield* installations.setHomeSavedView(userId, state.id, payload.savedViewId);
						}).pipe(Effect.provideService(Database, transaction)),
					),
				);
				if (!updated) {
					return yield* new PluginNotFoundError({
						reason: { pluginSlug, code: "plugin-not-found" },
					});
				}
				yield* invalidator.user(userId);
				return payload;
			});

			const dispatchInstallationLifecycle = Effect.fn(
				"PluginInstallationService.dispatchInstallationLifecycle",
			)(function* (state: PluginInstallationRow) {
				const dispatched = yield* Effect.result(lifecycleDispatcher.dispatch(state.id));
				if (Result.isSuccess(dispatched)) {
					return state;
				}
				yield* Effect.logError("plugin installation lifecycle dispatch failed").pipe(
					Effect.annotateLogs({ installationId: state.id }),
				);
				const healthReason = "Installation lifecycle could not be started";
				yield* Effect.uninterruptible(
					installations
						.updateHealth({ healthReason, id: state.id, health: "failed" })
						.pipe(Effect.andThen(invalidator.user(UserId.make(state.userId)))),
				);
				return { ...state, healthReason, health: "failed" as const };
			});

			const installPrivateUnlocked = Effect.fn("PluginInstallationService.installPrivateUnlocked")(
				function* (input: DecodedInstallPrivatePluginInput) {
					const { files, manifest, sourceHash } = yield* normalizePluginSource(input);
					const slug = manifest.metadata.slug;
					const pluginSlug = PluginSlug.make(slug);
					yield* validatePluginPackageLimits(files, manifest);
					const systemSlugs = yield* repository.listActiveSystemSlugs();
					yield* validatePluginManifestPolicy(manifest, {
						scope: "user",
						systemSlugs: new Set(systemSlugs),
					});
					yield* validatePluginSourcePaths(files, manifest);
					const owned = yield* repository.listPrivateForUser(input.userId);
					if (owned.some((plugin) => plugin.slug === slug)) {
						return yield* new PluginConflictError({
							reason: { pluginSlug, code: "already-installed" },
						});
					}
					const effectiveDefinitions = yield* buildEffectiveDefinitions(
						yield* definitions.getGlobalSnapshot,
						[...owned, { slug, manifest, id: "private-plugin-candidate" }],
					);
					yield* validateEffectiveSurfaceSlugs([
						...(yield* repository.listActiveSystemPlugins()),
						...owned,
						{ slug, manifest },
					]);
					yield* validatePluginManifestReferences(manifest, effectiveDefinitions);
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
					const normalized = yield* compilePluginPackage({ files, manifest, sourceHash }).pipe(
						Effect.provideService(ClientPluginCompiler, clientCompiler),
					);
					yield* validatePluginExecutableScripts(normalized);
					const state = yield* Effect.uninterruptible(
						mapDatabaseErrors(
							database.transaction((transaction) =>
								Effect.gen(function* () {
									const pluginId = yield* ingestionLock.persistUserPlugin(normalized, {
										slug,
										scope: "user",
										ownerId: input.userId,
									});
									const existing = yield* installations.findByUserAndPlugin(input.userId, pluginId);
									const current = yield* installations.listForUser(input.userId);
									const sortOrder =
										existing?.sortOrder ??
										Math.max(
											systemSlugs.length - 1,
											...current.map(({ sortOrder: order }) => order),
										) + 1;
									const existingState = yield* installations.upsertState({
										config,
										pluginId,
										sortOrder,
										isDisabled: false,
										health: "installing",
										userId: input.userId,
									});
									if (!existingState) {
										return yield* new DbError({
											message: "Plugin installation upsert returned no row",
										});
									}
									yield* definitionMaterializer.materialize(input.userId);
									return existingState;
								}).pipe(Effect.provideService(Database, transaction)),
							),
						).pipe(Effect.tap(() => invalidator.user(input.userId))),
					);
					yield* dispatchInstallationLifecycle(state);
					return { id: state.id, pluginId: PluginId.make(state.pluginId) };
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
					const pluginSlug = PluginSlug.make(input.pluginSlug);
					if (yield* repository.findActiveSystemPlugin(input.pluginSlug)) {
						return yield* new PluginConflictError({
							reason: { pluginSlug, code: "system-plugin" },
						});
					}
					const plugin = (yield* repository.listPrivateForUser(input.userId)).find(
						(candidate) => candidate.slug === input.pluginSlug,
					);
					if (!plugin) {
						return yield* new PluginNotFoundError({
							reason: { pluginSlug, code: "plugin-not-found" },
						});
					}
					const installation = yield* installations.findByUserAndPlugin(input.userId, plugin.id);
					if (!installation) {
						return yield* new PluginNotFoundError({
							reason: { pluginSlug, code: "plugin-not-found" },
						});
					}
					return yield* withPrivatePluginPackage(input, input.userId, (pluginPackage) =>
						Effect.gen(function* () {
							const { files, manifest, sourceHash } = yield* normalizePluginSource(pluginPackage);
							if (manifest.metadata.slug !== plugin.slug) {
								return yield* new PluginValidationError({
									issues: [
										`Plugin slug cannot change from ${plugin.slug} to ${manifest.metadata.slug}`,
									],
								});
							}
							yield* validatePluginPackageLimits(files, manifest);
							yield* validatePluginManifestPolicy(manifest, {
								scope: "user",
								systemSlugs: new Set(yield* repository.listActiveSystemSlugs()),
							});
							yield* validatePluginSourcePaths(files, manifest);
							const effectiveDefinitions = yield* buildEffectiveDefinitions(
								yield* definitions.getGlobalSnapshot,
								[
									...(yield* repository.listPrivateForUser(input.userId)).filter(
										(candidate) => candidate.id !== plugin.id,
									),
									{ manifest, id: plugin.id, slug: plugin.slug },
								],
							);
							yield* validateEffectiveSurfaceSlugs([
								...(yield* repository.listActiveSystemPlugins()),
								...(yield* repository.listPrivateForUser(input.userId)).filter(
									(candidate) => candidate.id !== plugin.id,
								),
								{ manifest, slug: plugin.slug },
							]);
							yield* validatePluginManifestReferences(manifest, effectiveDefinitions);
							yield* validateAdditiveSchemaEvolution(plugin.manifest, manifest);
							const normalized = yield* compilePluginPackage({ files, manifest, sourceHash }).pipe(
								Effect.provideService(ClientPluginCompiler, clientCompiler),
							);
							yield* validatePluginExecutableScripts(normalized);

							const updated = yield* Effect.uninterruptible(
								mapDatabaseErrors(
									database.transaction((transaction) =>
										Effect.gen(function* () {
											yield* repository.lockIngestion();
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
													reason: { pluginSlug, code: "plugin-not-found" },
												});
											}
											yield* validateAdditiveSchemaEvolution(current.manifest, manifest);
											const configResult = yield* Effect.result(
												validateConfigPatch(manifest, currentInstallation.config, input),
											);
											const persistedId = yield* ingestionLock.persistUserPlugin(normalized, {
												scope: "user",
												slug: current.slug,
												ownerId: input.userId,
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
											const state = yield* installations.updateState({
												id: currentInstallation.id,
												config: configResult.success,
												sortOrder: currentInstallation.sortOrder,
												isDisabled: currentInstallation.isDisabled,
											});
											if (!state) {
												return yield* new PluginNotFoundError({
													reason: { pluginSlug, code: "plugin-not-found" },
												});
											}
											if (currentInstallation.health !== "incompatible") {
												yield* definitionMaterializer.materialize(input.userId);
												return { id: state.id };
											}
											yield* installations.updateHealth({
												health: "ready",
												healthReason: null,
												id: currentInstallation.id,
											});
											yield* definitionMaterializer.materialize(input.userId);
											return { id: state.id };
										}).pipe(Effect.provideService(Database, transaction)),
									),
								).pipe(Effect.tap(() => invalidator.user(input.userId))),
							);
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
			)(function* (userId: UserId, slug: string, payload: UpdatePluginInstallationBody) {
				yield* repository.lockIngestion();
				const pluginSlug = PluginSlug.make(slug);
				const systemPlugin = yield* repository.findActiveSystemPlugin(slug);
				const privatePlugin = systemPlugin
					? undefined
					: (yield* repository.listPrivateForUser(userId)).find(
							(candidate) => candidate.slug === slug,
						);
				const plugin = systemPlugin ?? privatePlugin;
				if (!plugin) {
					return yield* new PluginNotFoundError({
						reason: { pluginSlug, code: "plugin-not-found" },
					});
				}
				const state = yield* installations.findByUserAndPlugin(userId, plugin.id);
				if (!state) {
					return yield* new PluginNotFoundError({
						reason: { pluginSlug, code: "plugin-not-found" },
					});
				}
				if (
					plugin.scope === "system" &&
					(Object.hasOwn(payload, "config") || Object.hasOwn(payload, "unsetConfigKeys"))
				) {
					return yield* new PluginConflictError({ reason: { pluginSlug, code: "system-plugin" } });
				}
				const isDisabled = payload.isDisabled ?? state.isDisabled;
				if (
					payload.isDisabled === false &&
					state.health !== "ready" &&
					state.health !== "needs-configuration"
				) {
					return yield* new PluginConflictError({
						reason: { pluginSlug, health: state.health, code: "installation-not-ready" },
					});
				}
				const config =
					plugin.scope === "system"
						? {}
						: yield* validateConfigPatch(plugin.manifest, state.config, payload);
				const saved = yield* Effect.uninterruptible(
					installations
						.updateState({
							config,
							isDisabled,
							id: state.id,
							sortOrder: payload.sortOrder ?? state.sortOrder,
						})
						.pipe(
							Effect.tap((result) =>
								state.health === "needs-configuration" && result?.health === "ready"
									? definitionMaterializer.materialize(userId)
									: Effect.void,
							),
							Effect.tap((result) => (result ? invalidator.user(userId) : Effect.void)),
						),
				);
				if (!saved) {
					return yield* new PluginNotFoundError({
						reason: { pluginSlug, code: "plugin-not-found" },
					});
				}
				return { id: saved.id, pluginId: PluginId.make(plugin.id) };
			});

			const updateInstallation = Effect.fn("PluginInstallationService.updateInstallation")(
				(userId: UserId, slug: string, payload: UpdatePluginInstallationBody) =>
					mapDatabaseErrors(
						database.transaction((transaction) =>
							updateInstallationUnlocked(userId, slug, payload).pipe(
								Effect.provideService(Database, transaction),
							),
						),
					).pipe(
						Effect.catchTag("PluginValidationError", (error) =>
							Effect.fail(
								new PluginRequestError({
									reason: {
										code: "validation-failed",
										diagnostics: error.issues.map((message) => ({
											message,
											phase: "validate" as const,
											severity: "error" as const,
											code: "plugin-validation-error",
										})),
									},
								}),
							),
						),
					),
			);

			const assertUnreferenced = Effect.fn("PluginInstallationService.assertUnreferenced")(
				function* (
					plugin: StoredPlugin,
					installation: PluginInstallationRow,
					pluginSlug: PluginSlug,
				) {
					if (
						yield* repository.hasIntegrationReferences({
							pluginId: plugin.id,
							pluginInstallationId: installation.id,
						})
					) {
						return yield* new PluginConflictError({
							reason: { pluginSlug, code: "integration-referenced" },
						});
					}
					const entitySchemaSlugs = plugin.manifest.entitySchemas.map(({ slug }) => slug);
					if (yield* repository.hasEntityReferences({ entitySchemaSlugs, pluginId: plugin.id })) {
						return yield* new PluginConflictError({
							reason: { pluginSlug, code: "entity-referenced" },
						});
					}
					if (yield* repository.hasDefinitionReferences(plugin.id)) {
						return yield* new PluginConflictError({
							reason: { pluginSlug, code: "entity-referenced" },
						});
					}
					if (
						yield* definitionMaterializer.hasCustomSavedViewReferences(
							UserId.make(installation.userId),
							installation.id,
						)
					) {
						return yield* new PluginConflictError({
							reason: { pluginSlug, code: "saved-view-referenced" },
						});
					}
					return yield* Effect.void;
				},
			);

			const uninstallPlugin = Effect.fn("PluginInstallationService.uninstallPlugin")(function* (
				userId: UserId,
				slug: string,
			) {
				const pluginSlug = PluginSlug.make(slug);
				const owned = yield* repository.listPrivateForUser(userId);
				const plugin = owned.find((candidate) => candidate.slug === slug);
				if (!plugin) {
					if (yield* repository.findActiveSystemPlugin(slug)) {
						return yield* new PluginConflictError({
							reason: { pluginSlug, code: "system-plugin" },
						});
					}
					return yield* new PluginNotFoundError({
						reason: { pluginSlug, code: "plugin-not-found" },
					});
				}
				const installation = yield* installations.findByUserAndPlugin(userId, plugin.id);
				if (!installation) {
					return yield* new PluginNotFoundError({
						reason: { pluginSlug, code: "plugin-not-found" },
					});
				}
				yield* Effect.uninterruptible(
					mapDatabaseErrors(
						database.transaction((transaction) =>
							Effect.gen(function* () {
								yield* repository.lockIngestion();
								const current = yield* repository.findPrivateByIdForUser(plugin.id, userId);
								const currentInstallation = yield* installations.findByUserAndPlugin(
									userId,
									plugin.id,
								);
								if (!current || currentInstallation?.id !== installation.id) {
									return yield* new PluginNotFoundError({
										reason: { pluginSlug, code: "plugin-not-found" },
									});
								}
								yield* definitionMaterializer.removeGenerated(currentInstallation.id);
								yield* assertUnreferenced(current, currentInstallation, pluginSlug);
								yield* installations.remove(currentInstallation.id);
								yield* repository.deactivate(current.id);
								return undefined;
							}).pipe(Effect.provideService(Database, transaction)),
						),
					).pipe(Effect.andThen(invalidator.user(userId))),
				);
				return { id: installation.id, pluginId: PluginId.make(plugin.id) };
			});

			return {
				setHomeView,
				uninstallPlugin,
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
}
