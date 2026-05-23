import type { PluginManifest } from "@ryot/contract/modules/plugins/manifest";
import {
	PluginConflictError,
	PluginNotFoundError,
	PluginRequestError,
	type PluginInstallationItem,
	type UpdatePrivatePluginBody,
	type UpdatePluginInstallationBody,
} from "@ryot/contract/modules/plugins/schemas";
import { PluginSlug, type UserId } from "@ryot/contract/schema/brands";
import type { AppPropertyDefinition, AppSchema } from "@ryot/contract/schema/property-schema";
import { Context, Effect, Layer } from "effect";

import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import {
	formatPropertyIssues,
	parseAppSchemaProperties,
} from "#lib/property-schema/property-schema-runtime";
import {
	buildDefinitionSnapshot,
	definitionSourceFromSnapshot,
} from "#modules/definition-registry/service";
import { SandboxWorkflowReferenceRepository } from "#modules/sandbox/workflow-reference-repository";

import { PluginDefinitionMaterializer } from "./definition-materializer";
import {
	PluginInstallationRepository,
	type PluginInstallationRow,
} from "./installation-repository";
import { mergeManifestDefinitions, PluginLoader } from "./loader";
import { compilePluginPackage, pluginSourceHash, structurePluginFailure } from "./pipeline";
import { PluginRepository } from "./repository";
import { validateAdditiveSchemaEvolution } from "./schema-evolution";
import type { StoredPlugin } from "./types";
import {
	decodePluginManifest,
	PluginValidationError,
	validatePluginExecutableScripts,
	validatePluginManifestReferences,
	validatePluginPackageLimits,
	validatePluginSourcePaths,
	validatePrivateManifestSurfaces,
	validatePrivateSlugAvailability,
} from "./validation";

type InstallPrivatePluginInput = {
	readonly userId: UserId;
	readonly manifest: unknown;
	readonly config: Record<string, unknown>;
	readonly files: Readonly<Record<string, string>>;
};

type UpdatePrivatePluginInput = UpdatePrivatePluginBody & {
	readonly userId: UserId;
	readonly pluginSlug: string;
};

type InstallationView = {
	readonly sourceHash: string;
	readonly manifest: PluginManifest;
	readonly defaultSortOrder: number;
	readonly scope: "system" | "user";
	readonly state: PluginInstallationRow | null;
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
		try: () =>
			buildDefinitionSnapshot(
				mergeManifestDefinitions(definitionSourceFromSnapshot(systemDefinitions), plugins),
			),
		catch: (error) =>
			new PluginValidationError({
				issues: [error instanceof Error ? error.message : String(error)],
			}),
	});

const validateEffectiveSurfaceSlugs = (
	plugins: ReadonlyArray<{ readonly slug: string; readonly manifest: PluginManifest }>,
) =>
	Effect.try({
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
		catch: (error) =>
			new PluginValidationError({
				issues: [error instanceof Error ? error.message : String(error)],
			}),
	});

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const sanitizeConfigValue = (
	definition: AppPropertyDefinition,
	value: unknown,
	path: string,
	configuredSecrets: Set<string>,
): unknown => {
	if (definition.secret === true) {
		if (value !== null && value !== undefined) {
			configuredSecrets.add(path);
		}
		return undefined;
	}
	if (definition.type === "object" && isRecord(value)) {
		return sanitizeConfig(definition.properties, value, path, configuredSecrets);
	}
	if (definition.type === "array" && Array.isArray(value)) {
		return value.flatMap((item) => {
			const sanitized = sanitizeConfigValue(definition.items, item, `${path}[]`, configuredSecrets);
			return sanitized === undefined ? [] : [sanitized];
		});
	}
	return value;
};

const sanitizeConfig = (
	fields: AppSchema["fields"],
	value: Readonly<Record<string, unknown>>,
	prefix: string,
	configuredSecrets: Set<string>,
) => {
	const sanitized = { ...value };
	for (const [key, definition] of Object.entries(fields)) {
		if (!Object.hasOwn(value, key)) {
			continue;
		}
		const path = prefix ? `${prefix}.${key}` : key;
		const field = sanitizeConfigValue(definition, value[key], path, configuredSecrets);
		if (field === undefined) {
			Reflect.deleteProperty(sanitized, key);
		} else {
			sanitized[key] = field;
		}
	}
	return sanitized;
};

const sanitizeConfigDefinition = (definition: AppPropertyDefinition): AppPropertyDefinition => {
	if (definition.type === "object") {
		const { defaultValue, properties: _properties, ...withoutDefault } = definition;
		const properties = Object.fromEntries(
			Object.entries(definition.properties).map(([key, child]) => [
				key,
				sanitizeConfigDefinition(child),
			]),
		);
		if (definition.secret === true || defaultValue === undefined) {
			return { ...withoutDefault, properties };
		}
		return {
			...withoutDefault,
			properties,
			defaultValue: sanitizeConfig(definition.properties, defaultValue, "", new Set()),
		};
	}
	if (definition.type === "array") {
		const { defaultValue, items: _items, ...withoutDefault } = definition;
		const items = sanitizeConfigDefinition(definition.items);
		if (definition.secret === true || defaultValue === undefined) {
			return { ...withoutDefault, items };
		}
		const sanitizedDefault = defaultValue.flatMap((item) => {
			const sanitized = sanitizeConfigValue(definition.items, item, "", new Set());
			return sanitized === undefined ? [] : [sanitized];
		});
		return { ...withoutDefault, defaultValue: sanitizedDefault, items };
	}
	if (definition.secret === true) {
		const { defaultValue: _defaultValue, ...withoutDefault } = definition;
		return withoutDefault;
	}
	return definition;
};

const sanitizeConfigSchema = (schema: AppSchema): AppSchema => ({
	...schema,
	fields: Object.fromEntries(
		Object.entries(schema.fields).map(([key, definition]) => [
			key,
			sanitizeConfigDefinition(definition),
		]),
	),
});

const toInstallationItem = (view: InstallationView): PluginInstallationItem => {
	const storedConfig = view.scope === "system" ? {} : (view.state?.config ?? {});
	const configuredSecrets = new Set<string>();
	const config = sanitizeConfig(
		view.manifest.configSchema.fields,
		storedConfig,
		"",
		configuredSecrets,
	);
	return {
		...view.manifest.metadata,
		config,
		scope: view.scope,
		sourceHash: view.sourceHash,
		health: view.state?.health ?? "ready",
		isDisabled: view.state?.isDisabled ?? false,
		healthReason: view.state?.healthReason ?? null,
		configuredSecrets: [...configuredSecrets].sort(),
		slug: PluginSlug.make(view.manifest.metadata.slug),
		sortOrder: view.state?.sortOrder ?? view.defaultSortOrder,
		configSchema: sanitizeConfigSchema(view.manifest.configSchema),
	};
};

export class PluginInstallationService extends Context.Service<PluginInstallationService>()(
	"PluginInstallationService",
	{
		make: Effect.gen(function* () {
			const database = yield* Database;
			const loader = yield* PluginLoader;
			const repository = yield* PluginRepository;
			const installations = yield* PluginInstallationRepository;
			const definitionMaterializer = yield* PluginDefinitionMaterializer;
			const workflowReferences = yield* SandboxWorkflowReferenceRepository;

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

			const provisionSystemInstallationsForAllUsers = Effect.fn(
				"PluginInstallationService.provisionSystemInstallationsForAllUsers",
			)(() => installations.provisionSystemInstallationsForAllUsers());

			const listInstallations = Effect.fn("PluginInstallationService.listInstallations")(function* (
				userId: UserId,
			) {
				const states = yield* installations.listForUser(userId);
				const privatePlugins = yield* repository.listPrivateForUser(userId);
				const stateByPluginId = new Map(states.map((state) => [state.pluginId, state]));
				const systemPlugins = Object.values(loader.getSnapshot().plugins);
				const systemItems = systemPlugins.map((plugin, index) =>
					toInstallationItem({
						scope: "system",
						defaultSortOrder: index,
						manifest: plugin.manifest,
						sourceHash: plugin.sourceHash,
						state: stateByPluginId.get(plugin.id) ?? null,
					}),
				);
				const privateItems = privatePlugins.map((plugin, index) =>
					toInstallationItem({
						scope: "user",
						manifest: plugin.manifest,
						sourceHash: plugin.sourceHash,
						defaultSortOrder: systemPlugins.length + index,
						state: stateByPluginId.get(plugin.id) ?? null,
					}),
				);
				return [...systemItems, ...privateItems].sort(
					(left, right) => left.sortOrder - right.sortOrder || left.slug.localeCompare(right.slug),
				);
			});

			const installPrivateUnlocked = Effect.fn("PluginInstallationService.installPrivateUnlocked")(
				function* (input: InstallPrivatePluginInput) {
					const manifest = yield* decodePluginManifest(input.manifest);
					const slug = manifest.metadata.slug;
					const pluginSlug = PluginSlug.make(slug);
					yield* validatePluginPackageLimits(input.files, manifest);
					yield* validatePrivateManifestSurfaces(manifest);
					const systemManifests = yield* repository.listActiveManifests();
					yield* validatePrivateSlugAvailability(
						slug,
						new Set(systemManifests.map(({ metadata }) => metadata.slug)),
					);
					yield* validatePluginSourcePaths(input.files, manifest.scripts);
					const owned = yield* repository.listPrivateForUser(input.userId);
					if (owned.some((plugin) => plugin.slug === slug)) {
						return yield* new PluginConflictError({
							reason: { code: "already-installed", pluginSlug },
						});
					}
					const effectiveDefinitions = yield* buildEffectiveDefinitions(
						loader.getSnapshot().definitions,
						[...owned, { id: "private-plugin-candidate", slug, manifest }],
					);
					yield* validateEffectiveSurfaceSlugs([
						...Object.values(loader.getSnapshot().plugins),
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
					const sourceHash = pluginSourceHash(manifest, input.files);
					const normalized = yield* compilePluginPackage({
						manifest,
						sourceHash,
						files: input.files,
					});
					yield* validatePluginExecutableScripts(normalized);
					const state = yield* Effect.uninterruptible(
						mapDatabaseErrors(
							database.transaction((transaction) =>
								Effect.gen(function* () {
									yield* repository.lockIngestion();
									const pluginId = yield* repository.persist(normalized, {
										slug,
										scope: "user",
										ownerId: input.userId,
									});
									const existing = yield* installations.findByUserAndPlugin(input.userId, pluginId);
									const current = yield* installations.listForUser(input.userId);
									const sortOrder =
										existing?.sortOrder ??
										Math.max(
											Object.keys(loader.getSnapshot().plugins).length - 1,
											...current.map(({ sortOrder: order }) => order),
										) + 1;
									const existingState = existing
										? yield* installations.upsertState({
												config,
												sortOrder,
												pluginId,
												isDisabled: false,
												userId: input.userId,
											})
										: yield* installations.create({
												config,
												pluginId,
												sortOrder,
												health: "ready",
												isDisabled: false,
												userId: input.userId,
											});
									yield* definitionMaterializer.materialize(input.userId);
									return existingState;
								}).pipe(Effect.provideService(Database, transaction)),
							),
						),
					);
					return toInstallationItem({
						manifest,
						sourceHash,
						scope: "user",
						defaultSortOrder: 0,
						state: state ?? null,
					});
				},
			);

			const installPrivatePlugin = Effect.fn("PluginInstallationService.installPrivatePlugin")(
				(input: InstallPrivatePluginInput) =>
					installPrivateUnlocked(input).pipe(structurePluginFailure),
			);

			const updatePrivateUnlocked = Effect.fn("PluginInstallationService.updatePrivateUnlocked")(
				function* (input: UpdatePrivatePluginInput) {
					const pluginSlug = PluginSlug.make(input.pluginSlug);
					if (loader.getSnapshot().plugins[input.pluginSlug]) {
						return yield* new PluginConflictError({
							reason: { code: "system-plugin", pluginSlug },
						});
					}
					const plugin = (yield* repository.listPrivateForUser(input.userId)).find(
						(candidate) => candidate.slug === input.pluginSlug,
					);
					if (!plugin) {
						return yield* new PluginNotFoundError({
							reason: { code: "plugin-not-found", pluginSlug },
						});
					}
					const installation = yield* installations.findByUserAndPlugin(input.userId, plugin.id);
					if (!installation) {
						return yield* new PluginNotFoundError({
							reason: { code: "plugin-not-found", pluginSlug },
						});
					}
					const manifest = yield* decodePluginManifest(input.manifest);
					if (manifest.metadata.slug !== plugin.slug) {
						return yield* new PluginValidationError({
							issues: [
								`Plugin slug cannot change from ${plugin.slug} to ${manifest.metadata.slug}`,
							],
						});
					}
					yield* validatePluginPackageLimits(input.files, manifest);
					yield* validatePrivateManifestSurfaces(manifest);
					yield* validatePluginSourcePaths(input.files, manifest.scripts);
					const effectiveDefinitions = yield* buildEffectiveDefinitions(
						loader.getSnapshot().definitions,
						[
							...(yield* repository.listPrivateForUser(input.userId)).filter(
								(candidate) => candidate.id !== plugin.id,
							),
							{ id: plugin.id, slug: plugin.slug, manifest },
						],
					);
					yield* validateEffectiveSurfaceSlugs([
						...Object.values(loader.getSnapshot().plugins),
						...(yield* repository.listPrivateForUser(input.userId)).filter(
							(candidate) => candidate.id !== plugin.id,
						),
						{ slug: plugin.slug, manifest },
					]);
					yield* validatePluginManifestReferences(manifest, effectiveDefinitions);
					yield* validateAdditiveSchemaEvolution(plugin.manifest, manifest);
					yield* validateConfigPatch(manifest, installation.config, input);
					const sourceHash = pluginSourceHash(manifest, input.files);
					const normalized = yield* compilePluginPackage({
						manifest,
						sourceHash,
						files: input.files,
					});
					yield* validatePluginExecutableScripts(normalized);

					const updated = yield* Effect.uninterruptible(
						mapDatabaseErrors(
							database.transaction((transaction) =>
								Effect.gen(function* () {
									yield* repository.lockIngestion();
									const current = yield* repository.findPrivateByIdForUser(plugin.id, input.userId);
									const currentInstallation = yield* installations.findByUserAndPlugin(
										input.userId,
										plugin.id,
									);
									if (!current || currentInstallation?.id !== installation.id) {
										return yield* new PluginNotFoundError({
											reason: { code: "plugin-not-found", pluginSlug },
										});
									}
									yield* validatePrivateSlugAvailability(
										input.pluginSlug,
										new Set(
											(yield* repository.listActiveManifests()).map(
												({ metadata }) => metadata.slug,
											),
										),
									);
									yield* validateAdditiveSchemaEvolution(current.manifest, manifest);
									const config = yield* validateConfigPatch(
										manifest,
										currentInstallation.config,
										input,
									);
									const persistedId = yield* repository.persist(normalized, {
										scope: "user",
										slug: current.slug,
										ownerId: input.userId,
									});
									if (persistedId !== current.id) {
										return yield* new PluginValidationError({
											issues: ["Plugin update did not retain its stable identity"],
										});
									}
									const state = yield* installations.updateState({
										config,
										id: currentInstallation.id,
										sortOrder: currentInstallation.sortOrder,
										isDisabled: currentInstallation.isDisabled,
									});
									yield* definitionMaterializer.materialize(input.userId);
									return state ?? currentInstallation;
								}).pipe(Effect.provideService(Database, transaction)),
							),
						),
					);
					return toInstallationItem({
						manifest,
						sourceHash,
						scope: "user",
						state: updated,
						defaultSortOrder: updated.sortOrder,
					});
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
				const pluginSlug = PluginSlug.make(slug);
				const systemPlugin = loader.getSnapshot().plugins[slug];
				const privatePlugin = systemPlugin
					? undefined
					: (yield* repository.listPrivateForUser(userId)).find(
							(candidate) => candidate.slug === slug,
						);
				const plugin = systemPlugin ?? privatePlugin;
				if (!plugin) {
					return yield* new PluginNotFoundError({
						reason: { code: "plugin-not-found", pluginSlug },
					});
				}
				const state = yield* installations.findByUserAndPlugin(userId, plugin.id);
				if (!state) {
					return yield* new PluginNotFoundError({
						reason: { code: "plugin-not-found", pluginSlug },
					});
				}
				if (
					plugin.scope === "system" &&
					(Object.hasOwn(payload, "config") || Object.hasOwn(payload, "unsetConfigKeys"))
				) {
					return yield* new PluginConflictError({ reason: { code: "system-plugin", pluginSlug } });
				}
				const isDisabled = payload.isDisabled ?? state.isDisabled;
				if (payload.isDisabled === false && state.health !== "ready") {
					return yield* new PluginConflictError({
						reason: { code: "installation-not-ready", health: state.health, pluginSlug },
					});
				}
				const config =
					plugin.scope === "system"
						? {}
						: yield* validateConfigPatch(plugin.manifest, state.config, payload);
				const updated = yield* installations.updateState({
					config,
					isDisabled,
					id: state.id,
					sortOrder: payload.sortOrder ?? state.sortOrder,
				});
				return toInstallationItem({
					scope: plugin.scope,
					state: updated ?? state,
					manifest: plugin.manifest,
					sourceHash: plugin.sourceHash,
					defaultSortOrder: state.sortOrder,
				});
			});

			const updateInstallation = Effect.fn("PluginInstallationService.updateInstallation")(
				(userId: UserId, slug: string, payload: UpdatePluginInstallationBody) =>
					updateInstallationUnlocked(userId, slug, payload).pipe(
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
					if (yield* workflowReferences.hasInstallationReferences(installation.id)) {
						return yield* new PluginConflictError({
							reason: { code: "workflow-referenced", pluginSlug },
						});
					}
					if (
						yield* repository.hasIntegrationReferences({
							pluginId: plugin.id,
							pluginInstallationId: installation.id,
						})
					) {
						return yield* new PluginConflictError({
							reason: { code: "integration-referenced", pluginSlug },
						});
					}
					const entitySchemaSlugs = plugin.manifest.entitySchemas.map(({ slug }) => slug);
					if (yield* repository.hasEntityReferences({ pluginId: plugin.id, entitySchemaSlugs })) {
						return yield* new PluginConflictError({
							reason: { code: "entity-referenced", pluginSlug },
						});
					}
					if (yield* repository.hasDefinitionReferences(plugin.id)) {
						return yield* new PluginConflictError({
							reason: { code: "entity-referenced", pluginSlug },
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
				if (loader.getSnapshot().plugins[slug]) {
					return yield* new PluginConflictError({ reason: { code: "system-plugin", pluginSlug } });
				}
				const owned = yield* repository.listPrivateForUser(userId);
				const plugin = owned.find((candidate) => candidate.slug === slug);
				if (!plugin) {
					return yield* new PluginNotFoundError({
						reason: { code: "plugin-not-found", pluginSlug },
					});
				}
				const installation = yield* installations.findByUserAndPlugin(userId, plugin.id);
				if (!installation) {
					return yield* new PluginNotFoundError({
						reason: { code: "plugin-not-found", pluginSlug },
					});
				}
				yield* mapDatabaseErrors(
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
									reason: { code: "plugin-not-found", pluginSlug },
								});
							}
							yield* definitionMaterializer.removeGenerated(currentInstallation.id);
							yield* assertUnreferenced(current, currentInstallation, pluginSlug);
							yield* installations.remove(currentInstallation.id);
							yield* repository.deactivate(current.id);
							return undefined;
						}).pipe(Effect.provideService(Database, transaction)),
					),
				);
				return toInstallationItem({
					scope: "user",
					state: installation,
					manifest: plugin.manifest,
					sourceHash: plugin.sourceHash,
					defaultSortOrder: installation.sortOrder,
				});
			});

			return {
				uninstallPlugin,
				listInstallations,
				updateInstallation,
				updatePrivatePlugin,
				installPrivatePlugin,
				provisionSystemInstallations,
				provisionSystemInstallationsForAllUsers,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
