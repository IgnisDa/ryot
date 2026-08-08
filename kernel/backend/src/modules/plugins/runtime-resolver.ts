import type {
	PluginManifest,
	PluginProviderOperation,
} from "@ryot-app/contract/modules/plugins/manifest";
import {
	EntitySchemaSlug,
	PluginId,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, eq, inArray, isNull, type SQL } from "drizzle-orm";
import { Context, Data, Effect, Layer, Schema } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { PluginEnvironmentConfig } from "#lib/infrastructure/plugin-environment-config";
import {
	buildDefinitionSnapshot,
	definitionSourceFromSnapshot,
	type DefinitionSnapshot,
} from "#modules/definition-registry/service";

import { PluginConfigRevisions } from "./config-revisions";
import {
	PluginInstallationRepository,
	type PluginInstallationHealth,
} from "./installation-repository";
import {
	mergeManifestDefinitions,
	PluginLoader,
	PluginLoaderLive,
	type PluginRegistrySnapshot,
} from "./loader";
import { pluginPointerFields, storedScriptFields } from "./persisted-projections";
import { PluginRepository } from "./repository";

export class UnsupportedProviderOperationError extends Data.TaggedError(
	"UnsupportedProviderOperationError",
)<{
	readonly providerId: SandboxProviderId;
	readonly providerSlug: string | null;
	readonly operation: PluginProviderOperation;
	readonly reason: "inactive_provider" | "unsupported_operation" | "script_unavailable";
}> {}

export type AvailablePlugin = {
	readonly id: string;
	readonly slug: string;
	readonly sourceHash: string;
	readonly pluginRevisionId: string;
	readonly pluginConfigRevisionId: string | null;
	readonly isDisabled: boolean;
	readonly installationId: string;
	readonly scope: "system" | "user";
	readonly ownerUserId: UserId | null;
	readonly manifest: PluginManifest;
	readonly health: PluginInstallationHealth;
	readonly compiledHashes: Readonly<Record<string, string>>;
};
type CatalogPlugin = Pick<
	AvailablePlugin,
	"id" | "manifest" | "pluginRevisionId" | "scope" | "slug"
>;

// `definitionsForCatalog` folds the loader snapshot's kernel definitions into every result, so a
// memo entry is only valid for the snapshot object it was built from; `loader.replace` installs a
// fresh object and the `WeakMap` drops the whole generation with it.
const DEFINITION_MEMO_CAPACITY = 64;

const catalogDefinitionKey = (available: ReadonlyArray<CatalogPlugin>) =>
	available
		.map(({ id, slug, scope, pluginRevisionId }) =>
			[id, pluginRevisionId, scope, slug].join("\u0000"),
		)
		.sort()
		.join("\u0001");

export const CatalogDefinitionFingerprint = Schema.Struct({
	digest: Schema.String,
	pluginId: Schema.NullOr(PluginId),
});
export type CatalogDefinitionFingerprint = typeof CatalogDefinitionFingerprint.Type;

export const catalogDefinitionFingerprint = (definition: {
	readonly pluginId?: string | null | undefined;
}) =>
	Schema.decodeSync(CatalogDefinitionFingerprint)({
		pluginId: definition.pluginId ?? null,
		digest: sha256Base64Url(stableStringify(definition)),
	});

export const pluginConfigContextFor = (plugin: AvailablePlugin) => ({
	kind: "revision" as const,
	ownerUserId: plugin.ownerUserId,
	pluginRevisionId: plugin.pluginRevisionId,
	configSchema: plugin.manifest.configSchema,
	pluginConfigRevisionId: plugin.pluginConfigRevisionId,
});

const findRevisionScript = Effect.fn(function* (pluginRevisionId: string, scriptSlug: string) {
	const db = yield* Database;
	const [row] = yield* mapDatabaseErrors(
		db
			.select(storedScriptFields)
			.from(schema.sandboxScript)
			.where(
				and(
					eq(schema.sandboxScript.pluginRevisionId, pluginRevisionId),
					eq(schema.sandboxScript.slug, scriptSlug),
				),
			)
			.limit(1),
	);
	return row ? { ...row, id: SandboxScriptId.make(row.id) } : null;
});

export class PluginRuntimeResolver extends Context.Service<PluginRuntimeResolver>()(
	"PluginRuntimeResolver",
	{
		make: Effect.gen(function* () {
			const loader = yield* PluginLoader;
			const installations = yield* PluginInstallationRepository;
			const repository = yield* PluginRepository;
			const configs = yield* PluginConfigRevisions;
			const environmentConfig = yield* PluginEnvironmentConfig;
			const lockCatalog = repository.lockIngestionShared;

			// The repeated "active pointer row plus its immutable revision" shape. It deliberately
			// does not filter scope; the pointer row carries it, so each policy stays at its call site.
			const readActivePlugin = Effect.fn(function* (predicate: SQL | undefined) {
				const db = yield* Database;
				const [pointer] = yield* mapDatabaseErrors(
					db
						.select(pluginPointerFields)
						.from(schema.plugin)
						.where(and(eq(schema.plugin.status, "active"), predicate))
						.limit(1),
				);
				if (!pointer?.activeRevisionId) {
					return null;
				}
				return { pointer, revision: yield* repository.readRevision(pointer.activeRevisionId) };
			});

			const findActiveScriptInPluginSnapshot = Effect.fn(function* (
				snapshot: PluginRegistrySnapshot,
				input: { pluginSlug: string; scriptSlug: string; providerId?: string },
			) {
				const entry = snapshot.plugins[input.pluginSlug];
				if (!entry) {
					return null;
				}
				const active = yield* readActivePlugin(eq(schema.plugin.id, entry.id));
				if (!active || active.revision.sourceHash !== entry.sourceHash) {
					return null;
				}
				const script = yield* findRevisionScript(active.revision.id, input.scriptSlug);
				return script && (!input.providerId || script.providerId === input.providerId)
					? script
					: null;
			});

			const findActiveWorkflowScriptInSnapshot = (
				snapshot: PluginRegistrySnapshot,
				input: { pluginSlug: string; workflowSlug: string },
			) => {
				const scriptSlug = snapshot.plugins[input.pluginSlug]?.manifest.workflows.find(
					({ slug }) => slug === input.workflowSlug,
				)?.scriptSlug;
				return scriptSlug
					? findActiveScriptInPluginSnapshot(snapshot, { scriptSlug, pluginSlug: input.pluginSlug })
					: Effect.succeed(null);
			};

			const listPluginsAvailableToUser = Effect.fn(
				"PluginRuntimeResolver.listPluginsAvailableToUser",
			)(function* (userId: UserId, includeUnavailable = false) {
				const db = yield* Database;
				const states = yield* installations.listForUser(userId);
				if (states.length === 0) {
					return [];
				}
				const rows = yield* mapDatabaseErrors(
					db
						.select(pluginPointerFields)
						.from(schema.plugin)
						.where(
							and(
								eq(schema.plugin.status, "active"),
								inArray(
									schema.plugin.id,
									states.map(({ pluginId }) => pluginId),
								),
							),
						),
				);
				const revisionsById = yield* repository.readRevisions(
					rows.flatMap(({ activeRevisionId }) => (activeRevisionId ? [activeRevisionId] : [])),
				);
				const result: AvailablePlugin[] = [];
				for (const row of rows) {
					const state = states.find(({ pluginId }) => pluginId === row.id);
					const revision = row.activeRevisionId
						? revisionsById.get(row.activeRevisionId)
						: undefined;
					if (
						!state ||
						!row.activeRevisionId ||
						!revision ||
						(row.scope === "user" && row.ownerId !== userId)
					) {
						continue;
					}
					if (
						includeUnavailable
							? state.health === "incompatible"
							: state.health !== "ready" || state.isDisabled
					) {
						continue;
					}
					const configId =
						row.scope === "system"
							? (environmentConfig.find(row.id)?.configRevisionId ?? null)
							: state.activeConfigRevisionId;
					const [config] = configId
						? yield* mapDatabaseErrors(
								db
									.select({ revisionId: schema.pluginConfigRevision.pluginRevisionId })
									.from(schema.pluginConfigRevision)
									.where(eq(schema.pluginConfigRevision.id, configId)),
							)
						: [];
					if (!includeUnavailable && config?.revisionId !== row.activeRevisionId) {
						continue;
					}
					result.push({
						id: row.id,
						slug: row.slug,
						scope: row.scope,
						health: state.health,
						installationId: state.id,
						manifest: revision.manifest,
						isDisabled: state.isDisabled,
						sourceHash: revision.sourceHash,
						pluginConfigRevisionId: configId,
						pluginRevisionId: row.activeRevisionId,
						compiledHashes: revision.compiledHashes,
						ownerUserId: row.ownerId ? UserId.make(row.ownerId) : null,
					});
				}
				return result.sort((a, b) => a.slug.localeCompare(b.slug));
			});
			const definitionMemo = new WeakMap<PluginRegistrySnapshot, Map<string, DefinitionSnapshot>>();
			const buildCatalogDefinitions = (available: ReadonlyArray<CatalogPlugin>) => {
				const source = definitionSourceFromSnapshot(loader.getSnapshot().definitions);
				const base = {
					savedViews: source.savedViews.filter((value) => value.pluginId == null),
					entitySchemas: source.entitySchemas.filter((value) => value.pluginId == null),
					signalSchemas: source.signalSchemas.filter((value) => value.pluginId == null),
					relationshipSchemas: source.relationshipSchemas.filter((value) => value.pluginId == null),
				};
				const system = mergeManifestDefinitions(
					base,
					available.filter(({ scope }) => scope === "system"),
				);
				const privatePlugins: Array<CatalogPlugin> = [];
				for (const plugin of available) {
					if (plugin.scope !== "user") {
						continue;
					}
					privatePlugins.push({
						...plugin,
						manifest: {
							...plugin.manifest,
							entitySchemas: plugin.manifest.entitySchemas.filter(
								({ slug }) => !system.entitySchemas.some((entry) => entry.slug === slug),
							),
						},
					});
				}
				const entitySlugs = new Set([
					...system.entitySchemas.map(({ slug }) => slug),
					...privatePlugins.flatMap(({ manifest }) =>
						manifest.entitySchemas.map(({ slug }) => slug),
					),
				]);
				const withRelationships: Array<CatalogPlugin> = [];
				for (const plugin of privatePlugins) {
					withRelationships.push({
						...plugin,
						manifest: {
							...plugin.manifest,
							relationshipSchemas: plugin.manifest.relationshipSchemas.filter(
								(entry) =>
									!system.relationshipSchemas.some(({ slug }) => slug === entry.slug) &&
									[entry.sourceEntitySchemaSlug, entry.targetEntitySchemaSlug].every(
										(slug) => slug === null || entitySlugs.has(slug),
									),
							),
						},
					});
				}
				const relationshipSlugs = new Set([
					...system.relationshipSchemas.map(({ slug }) => slug),
					...withRelationships.flatMap(({ manifest }) =>
						manifest.relationshipSchemas.map(({ slug }) => slug),
					),
				]);
				const composable: Array<CatalogPlugin> = [];
				for (const plugin of withRelationships) {
					composable.push({
						...plugin,
						manifest: {
							...plugin.manifest,
							savedViews: plugin.manifest.savedViews.filter(
								({ slug }) => !system.savedViews.some((entry) => entry.slug === slug),
							),
							signalSchemas: plugin.manifest.signalSchemas.filter(
								(entry) =>
									!system.signalSchemas.some(({ slug }) => slug === entry.slug) &&
									(entry.audiencePolicy.kind !== "related_users" ||
										relationshipSlugs.has(entry.audiencePolicy.relationshipSchemaSlug)),
							),
						},
					});
				}
				return buildDefinitionSnapshot(mergeManifestDefinitions(system, composable));
			};
			// A plugin's manifest is a pure function of its revision id, so the catalog identity is a
			// complete key for the built snapshot.
			const definitionsForCatalog = (available: ReadonlyArray<CatalogPlugin>) => {
				const snapshot = loader.getSnapshot();
				let memo = definitionMemo.get(snapshot);
				if (!memo) {
					memo = new Map<string, DefinitionSnapshot>();
					definitionMemo.set(snapshot, memo);
				}
				const key = catalogDefinitionKey(available);
				const cached = memo.get(key);
				if (cached) {
					return cached;
				}
				const built = buildCatalogDefinitions(available);
				if (memo.size >= DEFINITION_MEMO_CAPACITY) {
					const oldest = memo.keys().next();
					if (!oldest.done) {
						memo.delete(oldest.value);
					}
				}
				memo.set(key, built);
				return built;
			};
			const getEffectiveDefinitions = Effect.fn("PluginRuntimeResolver.getEffectiveDefinitions")(
				function* (userId: UserId, includeUnavailable = false) {
					const available = yield* listPluginsAvailableToUser(userId, true);
					return definitionsForCatalog(
						available.filter((plugin) => {
							if (includeUnavailable) {
								return true;
							}
							return (
								!plugin.isDisabled &&
								(plugin.health === "ready" ||
									(plugin.scope === "system" && plugin.health === "installing"))
							);
						}),
					);
				},
			);
			const getGlobalDefinitions = Effect.fn("PluginRuntimeResolver.getGlobalDefinitions")(
				function* () {
					const db = yield* Database;
					const rows = yield* mapDatabaseErrors(
						db
							.select(pluginPointerFields)
							.from(schema.plugin)
							.where(and(eq(schema.plugin.status, "active"), eq(schema.plugin.scope, "system"))),
					);
					const revisionsById = yield* repository.readRevisions(
						rows.flatMap(({ activeRevisionId }) => (activeRevisionId ? [activeRevisionId] : [])),
					);
					const available: CatalogPlugin[] = [];
					for (const row of rows) {
						const revision = row.activeRevisionId
							? revisionsById.get(row.activeRevisionId)
							: undefined;
						if (!row.activeRevisionId || !revision) {
							continue;
						}
						available.push({
							id: row.id,
							slug: row.slug,
							scope: "system",
							manifest: revision.manifest,
							pluginRevisionId: row.activeRevisionId,
						});
					}
					return definitionsForCatalog(available);
				},
			);
			const findPluginAvailableToUser = Effect.fn(function* (userId: UserId, pluginId: string) {
				return (
					(yield* listPluginsAvailableToUser(userId)).find(({ id }) => id === pluginId) ?? null
				);
			});
			const findScriptInAvailablePlugin = (plugin: AvailablePlugin, slug: string) =>
				findRevisionScript(plugin.pluginRevisionId, slug);
			const findWorkflowScriptInAvailablePlugin = (
				plugin: AvailablePlugin,
				workflowSlug: string,
			) => {
				const slug = plugin.manifest.workflows.find(
					(entry) => entry.slug === workflowSlug,
				)?.scriptSlug;
				return slug ? findRevisionScript(plugin.pluginRevisionId, slug) : Effect.succeed(null);
			};
			const findWorkflowScriptAvailableToUser = Effect.fn(function* (
				userId: UserId,
				pluginId: string,
				workflowSlug: string,
				pluginInstallationId: string,
			) {
				const plugin = yield* findPluginAvailableToUser(userId, pluginId);
				return plugin?.installationId === pluginInstallationId
					? yield* findWorkflowScriptInAvailablePlugin(plugin, workflowSlug)
					: null;
			});
			const findScriptAvailableToUser = Effect.fn(function* (
				userId: UserId,
				pluginId: string,
				scriptSlug: string,
			) {
				const plugin = yield* findPluginAvailableToUser(userId, pluginId);
				return plugin ? yield* findScriptInAvailablePlugin(plugin, scriptSlug) : null;
			});
			const findOperationAvailableToUser = Effect.fn(function* (input: {
				userId: UserId;
				pluginSlug: string;
				operationSlug: string;
			}) {
				const plugins = yield* listPluginsAvailableToUser(input.userId);
				const plugin =
					plugins.find((entry) => entry.slug === input.pluginSlug && entry.scope === "system") ??
					plugins.find((entry) => entry.slug === input.pluginSlug);
				const operation = plugin?.manifest.operations.find(
					({ slug }) => slug === input.operationSlug,
				);
				const script =
					plugin && operation
						? yield* findScriptInAvailablePlugin(plugin, operation.scriptSlug)
						: null;
				return plugin && operation && script ? { plugin, script, operation } : null;
			});
			const findActiveScript = Effect.fn(function* (scriptSlug: string) {
				const snapshot = loader.getSnapshot();
				const plugin = Object.values(snapshot.plugins).find(({ manifest }) =>
					manifest.scripts.some(({ slug }) => slug === scriptSlug),
				);
				return plugin
					? yield* findActiveScriptInPluginSnapshot(snapshot, {
							scriptSlug,
							pluginSlug: plugin.slug,
						})
					: null;
			});
			const findActiveScriptById = Effect.fn(function* (scriptId: SandboxScriptId) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select({ ...storedScriptFields, pluginSlug: schema.plugin.slug })
						.from(schema.sandboxScript)
						.innerJoin(
							schema.plugin,
							eq(schema.plugin.activeRevisionId, schema.sandboxScript.pluginRevisionId),
						)
						.where(and(eq(schema.sandboxScript.id, scriptId), eq(schema.plugin.status, "active")))
						.limit(1),
				);
				return row ? { ...row, id: SandboxScriptId.make(row.id) } : null;
			});
			const findKernelScript = Effect.fn(function* (scriptSlug: string) {
				const contentHash = yield* repository.getKernelScriptContentHash(scriptSlug);
				if (!contentHash) {
					return null;
				}
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select(storedScriptFields)
						.from(schema.sandboxScript)
						.where(
							and(
								isNull(schema.sandboxScript.pluginRevisionId),
								eq(schema.sandboxScript.slug, scriptSlug),
								eq(schema.sandboxScript.contentHash, contentHash),
							),
						)
						.limit(1),
				);
				return row ? { ...row, id: SandboxScriptId.make(row.id) } : null;
			});
			const findActiveWorkflowScript = (input: { pluginSlug: string; workflowSlug: string }) =>
				findActiveWorkflowScriptInSnapshot(loader.getSnapshot(), input);
			const resolveActivePluginCron = Effect.fn(function* (input: {
				pluginSlug: string;
				cronSlug: string;
			}) {
				const snapshot = loader.getSnapshot();
				const cron = snapshot.plugins[input.pluginSlug]?.manifest.crons.find(
					({ slug }) => slug === input.cronSlug,
				);
				const script = cron
					? yield* findActiveScriptInPluginSnapshot(snapshot, {
							scriptSlug: cron.scriptSlug,
							pluginSlug: input.pluginSlug,
						})
					: null;
				return cron && script ? { cron, script } : null;
			});
			const resolveActivePluginUserBootstrap = Effect.fn(function* (input: {
				pluginSlug: string;
				bootstrapSlug: string;
			}) {
				const snapshot = loader.getSnapshot();
				const bootstrap = snapshot.plugins[input.pluginSlug]?.manifest.userBootstrap.find(
					({ slug }) => slug === input.bootstrapSlug,
				);
				const script = bootstrap
					? yield* findActiveScriptInPluginSnapshot(snapshot, {
							pluginSlug: input.pluginSlug,
							scriptSlug: bootstrap.scriptSlug,
						})
					: null;
				return bootstrap && script ? { script, bootstrap } : null;
			});
			const listPrivateCronSchedules = Effect.fn(function* () {
				const result = [];
				for (const row of yield* installations.listPrivateInstallations()) {
					const plugin = yield* findPluginAvailableToUser(UserId.make(row.userId), row.pluginId);
					if (plugin) {
						for (const cron of plugin.manifest.crons) {
							result.push({
								cron,
								pluginId: plugin.id,
								pluginSlug: plugin.slug,
								userId: UserId.make(row.userId),
								installationId: plugin.installationId,
							});
						}
					}
				}
				return result;
			});
			const resolvePrivatePluginCron = Effect.fn(function* (input: {
				installationId: string;
				cronSlug: string;
			}) {
				const state = yield* installations.findById(input.installationId);
				const plugin = state
					? yield* findPluginAvailableToUser(UserId.make(state.userId), state.pluginId)
					: null;
				const cron = plugin?.manifest.crons.find(({ slug }) => slug === input.cronSlug);
				const script =
					plugin && cron ? yield* findScriptInAvailablePlugin(plugin, cron.scriptSlug) : null;
				return state && plugin && cron && script
					? { cron, script, pluginSlug: plugin.slug, userId: UserId.make(state.userId) }
					: null;
			});
			const resolveInstallationBootstrap = Effect.fn(function* (installationId: string) {
				const state = yield* installations.findById(installationId);
				if (!state) {
					return null;
				}
				const active = yield* readActivePlugin(eq(schema.plugin.id, state.pluginId));
				if (!active) {
					return null;
				}
				const revisionId = active.revision.id;
				const entries = yield* Effect.forEach(active.revision.manifest.userBootstrap, (entry) =>
					Effect.gen(function* () {
						const script = yield* findRevisionScript(revisionId, entry.scriptSlug);
						return { slug: entry.slug, scriptId: script?.id ?? null };
					}),
				);
				return {
					entries,
					health: state.health,
					pluginScope: active.pointer.scope,
					userId: UserId.make(state.userId),
				};
			});
			const listSchemaProviders = Effect.fn(function* (input: {
				userId: UserId;
				entitySchemaSlugs?: ReadonlyArray<string>;
			}) {
				const available = yield* listPluginsAvailableToUser(input.userId);
				if (available.length === 0) {
					return [];
				}
				const definitions = definitionsForCatalog(available);
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.sandboxProvider)
						.where(
							inArray(
								schema.sandboxProvider.pluginId,
								available.map(({ id }) => id),
							),
						),
				);
				const pluginById = new Map(available.map((plugin) => [plugin.id, plugin]));
				return rows
					.flatMap((row) => {
						const plugin = pluginById.get(row.pluginId);
						if (
							!plugin ||
							!plugin.manifest.providers.some(({ slug }) => slug === row.slug) ||
							!definitions.entitySchemas[row.rootEntitySchemaSlug] ||
							(input.entitySchemaSlugs &&
								!input.entitySchemaSlugs.includes(row.rootEntitySchemaSlug))
						) {
							return [];
						}
						return [
							{
								entitySchemaSlug: EntitySchemaSlug.make(row.rootEntitySchemaSlug),
								provider: { ...row, pluginScope: plugin.scope, id: SandboxProviderId.make(row.id) },
							},
						];
					})
					.sort(
						(left, right) =>
							left.entitySchemaSlug.localeCompare(right.entitySchemaSlug) ||
							left.provider.slug.localeCompare(right.provider.slug),
					);
			});
			const findProviderAvailableToUser = Effect.fn(function* (
				userId: UserId,
				id: SandboxProviderId,
			) {
				return (
					(yield* listSchemaProviders({ userId })).find(({ provider }) => provider.id === id)
						?.provider ?? null
				);
			});
			const findProviderAvailableToUserBySlug = Effect.fn(function* (userId: UserId, slug: string) {
				return (
					(yield* listSchemaProviders({ userId })).find(({ provider }) => provider.slug === slug)
						?.provider ?? null
				);
			});
			const findActiveProviderById = Effect.fn(function* (id: SandboxProviderId) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.sandboxProvider)
						.where(eq(schema.sandboxProvider.id, id))
						.limit(1),
				);
				if (!row) {
					return null;
				}
				// `repository.list()` returned active *system* plugins only, so a provider owned by a
				// private plugin has never resolved through this reader.
				const active = yield* readActivePlugin(
					and(eq(schema.plugin.id, row.pluginId), eq(schema.plugin.scope, "system")),
				);
				return active?.revision.manifest.providers.some(({ slug }) => slug === row.slug)
					? { ...row, id: SandboxProviderId.make(row.id) }
					: null;
			});
			const findSchemaProviderBySlug = Effect.fn(function* (slug: string) {
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.select({ id: schema.sandboxProvider.id })
						.from(schema.sandboxProvider)
						.where(eq(schema.sandboxProvider.slug, slug)),
				);
				for (const row of rows) {
					const provider = yield* findActiveProviderById(SandboxProviderId.make(row.id));
					if (provider) {
						return {
							provider,
							entitySchemaSlug: EntitySchemaSlug.make(provider.rootEntitySchemaSlug),
						};
					}
				}
				return null;
			});
			const findAuthorizedSchemaProviderById = Effect.fn(function* (input: {
				pluginSlug: string;
				entitySchemaSlug: string;
				providerId: SandboxProviderId;
			}) {
				const provider = yield* findActiveProviderById(input.providerId);
				const active = yield* readActivePlugin(
					and(eq(schema.plugin.slug, input.pluginSlug), eq(schema.plugin.scope, "system")),
				);
				return provider &&
					active?.revision.manifest.entitySchemas.some(
						({ slug }) => slug === input.entitySchemaSlug,
					) &&
					provider.rootEntitySchemaSlug === input.entitySchemaSlug
					? { provider, entitySchemaSlug: EntitySchemaSlug.make(input.entitySchemaSlug) }
					: null;
			});
			const resolveProviderOperation = (
				operation: PluginProviderOperation,
				userId: UserId | null,
				providerId: SandboxProviderId,
			) =>
				Effect.gen(function* () {
					const provider = userId
						? yield* findProviderAvailableToUser(userId, providerId)
						: yield* findActiveProviderById(providerId);
					if (!provider) {
						return yield* new UnsupportedProviderOperationError({
							operation,
							providerId,
							providerSlug: null,
							reason: "inactive_provider",
						});
					}
					const db = yield* Database;
					const [pointer] = yield* mapDatabaseErrors(
						db
							.select(pluginPointerFields)
							.from(schema.plugin)
							.where(eq(schema.plugin.id, provider.pluginId))
							.limit(1),
					);
					const revision = pointer?.activeRevisionId
						? yield* repository.readRevision(pointer.activeRevisionId)
						: null;
					const definition = revision?.manifest.providers.find(
						({ slug }) => slug === provider.slug,
					);
					const scriptSlug =
						operation === "search-options"
							? definition?.operations.searchOptions
							: definition?.operations[operation];
					const script =
						revision && scriptSlug ? yield* findRevisionScript(revision.id, scriptSlug) : null;
					if (script?.metadata.kind !== "provider" || script.providerId !== providerId) {
						return yield* new UnsupportedProviderOperationError({
							operation,
							providerId,
							providerSlug: provider.slug,
							reason: scriptSlug ? "script_unavailable" : "unsupported_operation",
						});
					}
					return {
						...script,
						optionsSchema:
							"searchOptionsSchema" in script.metadata
								? (script.metadata.searchOptionsSchema ?? null)
								: null,
					};
				});
			const systemOperation = (operation: PluginProviderOperation) => (id: SandboxProviderId) =>
				resolveProviderOperation(operation, null, id);
			const userOperation =
				(operation: PluginProviderOperation) => (userId: UserId, id: SandboxProviderId) =>
					resolveProviderOperation(operation, userId, id);
			return {
				lockCatalog,
				findActiveScript,
				findKernelScript,
				listSchemaProviders,
				findActiveScriptById,
				getGlobalDefinitions,
				findActiveProviderById,
				getEffectiveDefinitions,
				resolveActivePluginCron,
				findActiveWorkflowScript,
				listPrivateCronSchedules,
				resolvePrivatePluginCron,
				findSchemaProviderBySlug,
				findPluginAvailableToUser,
				findScriptAvailableToUser,
				listPluginsAvailableToUser,
				findScriptInAvailablePlugin,
				findProviderAvailableToUser,
				findOperationAvailableToUser,
				resolveInstallationBootstrap,
				resolveActivePluginUserBootstrap,
				findAuthorizedSchemaProviderById,
				findWorkflowScriptAvailableToUser,
				findProviderAvailableToUserBySlug,
				findWorkflowScriptInAvailablePlugin,
				resolvePluginConfigContext: configs.read,
				resolveSearchScript: systemOperation("search"),
				resolveDetailsScript: systemOperation("details"),
				resolveResolveScript: systemOperation("resolve"),
				resolveUserSearchScript: userOperation("search"),
				resolveUserDetailsScript: userOperation("details"),
				resolveUserResolveScript: userOperation("resolve"),
				resolveTranslateScript: systemOperation("translate"),
				resolveUserTranslateScript: userOperation("translate"),
				resolveSearchOptionsScript: systemOperation("search-options"),
				resolveUserSearchOptionsScript: userOperation("search-options"),
				findDetailsScript: (id: SandboxProviderId) =>
					systemOperation("details")(id).pipe(
						Effect.catchTag("UnsupportedProviderOperationError", () => Effect.succeed(null)),
					),
				isSystemProviderAvailableToUser: Effect.fn(function* (
					userId: UserId,
					id: SandboxProviderId,
				) {
					const row = yield* findProviderAvailableToUser(userId, id);
					return row?.pluginScope === "system";
				}),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export const PluginRuntimeResolverLive = PluginRuntimeResolver.layer.pipe(
	Layer.provideMerge(
		Layer.mergeAll(
			PluginLoaderLive,
			PluginInstallationRepository.layer,
			PluginRepository.layer,
			PluginConfigRevisions.layer,
			PluginEnvironmentConfig.layer,
		),
	),
);
