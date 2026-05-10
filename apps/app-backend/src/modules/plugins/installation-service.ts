import type { PluginManifest } from "@ryot/contract/modules/plugins/manifest";
import {
	PluginConflictError,
	PluginNotFoundError,
	type PluginInstallationItem,
} from "@ryot/contract/modules/plugins/schemas";
import { PluginSlug, type UserId } from "@ryot/contract/schema/brands";
import { collectSecretProperties } from "@ryot/contract/schema/property-schema";
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

const toInstallationItem = (view: InstallationView): PluginInstallationItem => {
	const secrets = new Set(collectSecretProperties(view.manifest.configSchema));
	const storedConfig = view.scope === "system" ? {} : (view.state?.config ?? {});
	return {
		...view.manifest.metadata,
		scope: view.scope,
		sourceHash: view.sourceHash,
		health: view.state?.health ?? "ready",
		configSchema: view.manifest.configSchema,
		isDisabled: view.state?.isDisabled ?? false,
		healthReason: view.state?.healthReason ?? null,
		slug: PluginSlug.make(view.manifest.metadata.slug),
		sortOrder: view.state?.sortOrder ?? view.defaultSortOrder,
		config: Object.fromEntries(Object.entries(storedConfig).filter(([key]) => !secrets.has(key))),
		configuredSecrets: Object.entries(storedConfig).flatMap(([key, value]) =>
			secrets.has(key) && value !== null && value !== undefined ? [key] : [],
		),
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
				installPrivatePlugin,
				provisionSystemInstallations,
				provisionSystemInstallationsForAllUsers,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
