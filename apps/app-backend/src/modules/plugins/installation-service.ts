import type { PluginManifest } from "@ryot/contract/modules/plugins/manifest";
import {
	PluginConflictError,
	PluginNotFoundError,
	PluginRequestError,
	type PluginInstallationItem,
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
import { SandboxWorkflowReferenceRepository } from "#modules/sandbox/workflow-reference-repository";

import {
	PluginInstallationRepository,
	type PluginInstallationRow,
} from "./installation-repository";
import { PluginLoader } from "./loader";
import { compilePluginPackage, pluginSourceHash, structurePluginFailure } from "./pipeline";
import { PluginRepository } from "./repository";
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

type InstallationView = {
	readonly sourceHash: string;
	readonly manifest: PluginManifest;
	readonly defaultSortOrder: number;
	readonly scope: "system" | "user";
	readonly state: PluginInstallationRow | null;
};

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
	return {
		...view.manifest.metadata,
		scope: view.scope,
		sourceHash: view.sourceHash,
		health: view.state?.health ?? "ready",
		isDisabled: view.state?.isDisabled ?? false,
		healthReason: view.state?.healthReason ?? null,
		configuredSecrets: [...configuredSecrets].sort(),
		slug: PluginSlug.make(view.manifest.metadata.slug),
		sortOrder: view.state?.sortOrder ?? view.defaultSortOrder,
		configSchema: sanitizeConfigSchema(view.manifest.configSchema),
		config: sanitizeConfig(view.manifest.configSchema.fields, storedConfig, "", configuredSecrets),
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
			const workflowReferences = yield* SandboxWorkflowReferenceRepository;

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
					yield* validatePluginManifestReferences(manifest, loader.getSnapshot().definitions);
					const owned = yield* repository.listPrivateForUser(input.userId);
					if (owned.some((plugin) => plugin.slug === slug)) {
						return yield* new PluginConflictError({
							reason: { code: "already-installed", pluginSlug },
						});
					}
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
									return existing
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
				const mergedConfig = { ...state.config, ...payload.config };
				for (const key of payload.unsetConfigKeys ?? []) {
					delete mergedConfig[key];
				}
				const config =
					plugin.scope === "system"
						? {}
						: yield* parseAppSchemaProperties({
								kind: "Plugin config",
								properties: mergedConfig,
								propertiesSchema: plugin.manifest.configSchema,
							}).pipe(
								Effect.mapError(
									(error) =>
										new PluginValidationError({
											issues: [`Plugin config is invalid: ${formatPropertyIssues(error.issues)}`],
										}),
								),
							);
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
				function* (plugin: StoredPlugin, pluginSlug: PluginSlug) {
					if (yield* workflowReferences.hasReferences(plugin.id)) {
						return yield* new PluginConflictError({
							reason: { code: "workflow-referenced", pluginSlug },
						});
					}
					if (yield* repository.hasIntegrationReferences(plugin.slug)) {
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
				const states = yield* installations.listForUser(userId);
				const owned = yield* repository.listPrivateForUser(userId);
				const plugin = owned.find((candidate) => candidate.slug === slug);
				if (!plugin) {
					return yield* new PluginNotFoundError({
						reason: { code: "plugin-not-found", pluginSlug },
					});
				}
				yield* mapDatabaseErrors(
					database.transaction((transaction) =>
						assertUnreferenced(plugin, pluginSlug).pipe(
							Effect.andThen(repository.deactivate(plugin.id)),
							Effect.provideService(Database, transaction),
						),
					),
				);
				return toInstallationItem({
					scope: "user",
					manifest: plugin.manifest,
					sourceHash: plugin.sourceHash,
					defaultSortOrder: states.length,
					state: states.find((state) => state.pluginId === plugin.id) ?? null,
				});
			});

			return {
				uninstallPlugin,
				listInstallations,
				updateInstallation,
				installPrivatePlugin,
				provisionSystemInstallations,
				provisionSystemInstallationsForAllUsers,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
