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
import { and, asc, eq, exists, inArray, sql, type SQL } from "drizzle-orm";
import { Context, Data, Effect, Layer, Schema } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

import { PluginConfigRevisions } from "./config-revisions";
import {
	PluginInstallationRepository,
	type PluginInstallationHealth,
} from "./installation-repository";
import { storedScriptFields } from "./persisted-projections";
import { decodeStoredManifest, PluginRepository } from "./repository";

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

const manifestField = <Key extends keyof PluginManifest>(key: Key) =>
	sql<PluginManifest[Key]>`${schema.pluginRevision.manifest} -> ${sql.raw(`'${key}'`)}`;

const activeSystemPlugin = and(
	eq(schema.plugin.status, "active"),
	eq(schema.plugin.scope, "system"),
);

const declaresProvider = exists(
	sql`(select 1 from jsonb_array_elements(${schema.pluginRevision.manifest} -> 'providers') m where m ->> 'slug' = ${schema.sandboxProvider.slug})`,
);

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

const findSystemManifestField = Effect.fn(function* <Key extends keyof PluginManifest>(
	pluginSlug: string,
	key: Key,
) {
	const db = yield* Database;
	const [row] = yield* mapDatabaseErrors(
		db
			.select({ value: manifestField(key), revisionId: schema.pluginRevision.id })
			.from(schema.plugin)
			.innerJoin(
				schema.pluginRevision,
				eq(schema.pluginRevision.id, schema.plugin.activeRevisionId),
			)
			.where(and(activeSystemPlugin, eq(schema.plugin.slug, pluginSlug)))
			.limit(1),
	);
	return row ?? null;
});

const listSystemManifestField = Effect.fn(function* <Key extends keyof PluginManifest>(key: Key) {
	const db = yield* Database;
	return yield* mapDatabaseErrors(
		db
			.select({
				value: manifestField(key),
				pluginId: schema.plugin.id,
				pluginSlug: schema.plugin.slug,
			})
			.from(schema.plugin)
			.innerJoin(
				schema.pluginRevision,
				eq(schema.pluginRevision.id, schema.plugin.activeRevisionId),
			)
			.where(activeSystemPlugin),
	);
});

const bySlugs = <Entry extends { readonly pluginSlug: string }>(
	entries: Array<Entry>,
	slug: (entry: Entry) => string,
) =>
	entries.sort(
		(left, right) =>
			left.pluginSlug.localeCompare(right.pluginSlug) || slug(left).localeCompare(slug(right)),
	);

export class PluginRuntimeResolver extends Context.Service<PluginRuntimeResolver>()(
	"PluginRuntimeResolver",
	{
		make: Effect.gen(function* () {
			const installations = yield* PluginInstallationRepository;
			const repository = yield* PluginRepository;
			const configs = yield* PluginConfigRevisions;
			const lockCatalog = repository.lockIngestionShared;

			const queryAvailablePlugins = Effect.fn(function* (
				userId: UserId,
				listed: boolean,
				predicate?: SQL,
			) {
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.select({
							slug: schema.userPlugin.slug,
							id: schema.userPlugin.pluginId,
							scope: schema.userPlugin.scope,
							health: schema.userPlugin.health,
							manifest: schema.pluginRevision.manifest,
							isDisabled: schema.userPlugin.isDisabled,
							ownerUserId: schema.userPlugin.ownerUserId,
							sourceHash: schema.pluginRevision.sourceHash,
							installationId: schema.userPlugin.installationId,
							pluginRevisionId: schema.userPlugin.activeRevisionId,
							pluginConfigRevisionId: schema.userPlugin.configRevisionId,
							compiledHashes: sql<
								Record<string, string>
							>`coalesce((select jsonb_object_agg(s.slug, s.content_hash) from ${schema.sandboxScript} s where s.plugin_revision_id = ${schema.userPlugin.activeRevisionId}), '{}'::jsonb)`,
						})
						.from(schema.userPlugin)
						.innerJoin(
							schema.pluginRevision,
							eq(schema.pluginRevision.id, schema.userPlugin.activeRevisionId),
						)
						.where(
							and(
								eq(schema.userPlugin.userId, userId),
								listed
									? eq(schema.userPlugin.isListed, true)
									: eq(schema.userPlugin.isExecutable, true),
								predicate,
							),
						),
				);
				const result = yield* Effect.forEach(rows, (row) =>
					Effect.map(
						decodeStoredManifest(row.manifest, row.slug),
						(manifest): AvailablePlugin => ({
							...row,
							manifest,
							ownerUserId: row.ownerUserId ? UserId.make(row.ownerUserId) : null,
						}),
					),
				);
				return result.sort((a, b) => a.slug.localeCompare(b.slug));
			});

			const listPluginsAvailableToUser = Effect.fn(
				"PluginRuntimeResolver.listPluginsAvailableToUser",
			)((userId: UserId, listed = false) => queryAvailablePlugins(userId, listed));
			const findPluginAvailableToUser = Effect.fn(function* (userId: UserId, pluginId: string) {
				const [plugin] = yield* queryAvailablePlugins(
					userId,
					false,
					eq(schema.userPlugin.pluginId, pluginId),
				);
				return plugin ?? null;
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
				const plugins = yield* queryAvailablePlugins(
					input.userId,
					false,
					eq(schema.userPlugin.slug, input.pluginSlug),
				);
				const plugin = plugins.find((entry) => entry.scope === "system") ?? plugins[0];
				const operation = plugin?.manifest.operations.find(
					({ slug }) => slug === input.operationSlug,
				);
				const script =
					plugin && operation
						? yield* findScriptInAvailablePlugin(plugin, operation.scriptSlug)
						: null;
				return plugin && operation && script ? { plugin, script, operation } : null;
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
			const resolveActivePluginCron = Effect.fn(function* (input: {
				pluginSlug: string;
				cronSlug: string;
			}) {
				const row = yield* findSystemManifestField(input.pluginSlug, "crons");
				const cron = row?.value.find(({ slug }) => slug === input.cronSlug);
				const script =
					row && cron ? yield* findRevisionScript(row.revisionId, cron.scriptSlug) : null;
				return cron && script ? { cron, script } : null;
			});
			const resolveActivePluginUserBootstrap = Effect.fn(function* (input: {
				pluginSlug: string;
				bootstrapSlug: string;
			}) {
				const row = yield* findSystemManifestField(input.pluginSlug, "userBootstrap");
				const bootstrap = row?.value.find(({ slug }) => slug === input.bootstrapSlug);
				const script =
					row && bootstrap ? yield* findRevisionScript(row.revisionId, bootstrap.scriptSlug) : null;
				return bootstrap && script ? { script, bootstrap } : null;
			});
			const listSystemCronSchedules = Effect.fn(function* () {
				const rows = yield* listSystemManifestField("crons");
				return bySlugs(
					rows.flatMap(({ value, pluginSlug }) => value.map((cron) => ({ cron, pluginSlug }))),
					({ cron }) => cron.slug,
				);
			});
			const listSystemUserBootstraps = Effect.fn(function* () {
				const rows = yield* listSystemManifestField("userBootstrap");
				return bySlugs(
					rows.flatMap(({ value, pluginId, pluginSlug }) =>
						value.map((bootstrap) => ({ pluginId, bootstrap, pluginSlug })),
					),
					({ bootstrap }) => bootstrap.slug,
				);
			});
			const listPrivateCronSchedules = Effect.fn(function* () {
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.select({
							crons: manifestField("crons"),
							userId: schema.userPlugin.userId,
							pluginSlug: schema.userPlugin.slug,
							pluginId: schema.userPlugin.pluginId,
							installationId: schema.userPlugin.installationId,
						})
						.from(schema.userPlugin)
						.innerJoin(
							schema.pluginRevision,
							eq(schema.pluginRevision.id, schema.userPlugin.activeRevisionId),
						)
						.where(
							and(eq(schema.userPlugin.scope, "user"), eq(schema.userPlugin.isExecutable, true)),
						)
						.orderBy(asc(schema.userPlugin.userId), asc(schema.userPlugin.slug)),
				);
				return rows.flatMap(({ crons, userId, ...row }) =>
					crons.map((cron) => ({ ...row, cron, userId: UserId.make(userId) })),
				);
			});
			const resolvePrivatePluginCron = Effect.fn(function* (input: {
				installationId: string;
				cronSlug: string;
			}) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select({
							crons: manifestField("crons"),
							userId: schema.userPlugin.userId,
							pluginSlug: schema.userPlugin.slug,
							revisionId: schema.userPlugin.activeRevisionId,
						})
						.from(schema.userPlugin)
						.innerJoin(
							schema.pluginRevision,
							eq(schema.pluginRevision.id, schema.userPlugin.activeRevisionId),
						)
						.where(
							and(
								eq(schema.userPlugin.installationId, input.installationId),
								eq(schema.userPlugin.isExecutable, true),
							),
						)
						.limit(1),
				);
				const cron = row?.crons.find(({ slug }) => slug === input.cronSlug);
				const script =
					row && cron ? yield* findRevisionScript(row.revisionId, cron.scriptSlug) : null;
				return row && cron && script
					? { cron, script, pluginSlug: row.pluginSlug, userId: UserId.make(row.userId) }
					: null;
			});
			const resolveInstallationBootstrap = Effect.fn(function* (installationId: string) {
				const state = yield* installations.findById(installationId);
				if (!state) {
					return null;
				}
				const db = yield* Database;
				const [active] = yield* mapDatabaseErrors(
					db
						.select({
							scope: schema.plugin.scope,
							revisionId: schema.pluginRevision.id,
							userBootstrap: manifestField("userBootstrap"),
						})
						.from(schema.plugin)
						.innerJoin(
							schema.pluginRevision,
							eq(schema.pluginRevision.id, schema.plugin.activeRevisionId),
						)
						.where(and(eq(schema.plugin.id, state.pluginId), eq(schema.plugin.status, "active")))
						.limit(1),
				);
				if (!active) {
					return null;
				}
				const entries = yield* Effect.forEach(active.userBootstrap, (entry) =>
					Effect.gen(function* () {
						const script = yield* findRevisionScript(active.revisionId, entry.scriptSlug);
						return { slug: entry.slug, scriptId: script?.id ?? null };
					}),
				);
				return {
					entries,
					health: state.health,
					pluginScope: active.scope,
					userId: UserId.make(state.userId),
				};
			});
			const querySchemaProviders = Effect.fn(function* (userId: UserId, predicate?: SQL) {
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.select({
							id: schema.userSandboxProvider.id,
							slug: schema.userSandboxProvider.slug,
							name: schema.userSandboxProvider.name,
							pluginId: schema.userSandboxProvider.pluginId,
							createdAt: schema.userSandboxProvider.createdAt,
							updatedAt: schema.userSandboxProvider.updatedAt,
							pluginScope: schema.userSandboxProvider.pluginScope,
							information: schema.userSandboxProvider.information,
							rootEntitySchemaSlug: schema.userSandboxProvider.rootEntitySchemaSlug,
						})
						.from(schema.userSandboxProvider)
						.where(and(eq(schema.userSandboxProvider.userId, userId), predicate)),
				);
				return rows
					.map((row) => ({
						provider: { ...row, id: SandboxProviderId.make(row.id) },
						entitySchemaSlug: EntitySchemaSlug.make(row.rootEntitySchemaSlug),
					}))
					.sort(
						(left, right) =>
							left.entitySchemaSlug.localeCompare(right.entitySchemaSlug) ||
							left.provider.slug.localeCompare(right.provider.slug),
					);
			});
			const listSchemaProviders = Effect.fn(function* (input: {
				userId: UserId;
				entitySchemaSlugs?: ReadonlyArray<string>;
			}) {
				if (input.entitySchemaSlugs?.length === 0) {
					return [];
				}
				return yield* querySchemaProviders(
					input.userId,
					input.entitySchemaSlugs
						? inArray(schema.userSandboxProvider.rootEntitySchemaSlug, [...input.entitySchemaSlugs])
						: undefined,
				);
			});
			const findProviderAvailableToUser = Effect.fn(function* (
				userId: UserId,
				id: SandboxProviderId,
			) {
				const [row] = yield* querySchemaProviders(userId, eq(schema.userSandboxProvider.id, id));
				return row?.provider ?? null;
			});
			const findProviderAvailableToUserBySlug = Effect.fn(function* (userId: UserId, slug: string) {
				const [row] = yield* querySchemaProviders(
					userId,
					eq(schema.userSandboxProvider.slug, slug),
				);
				return row?.provider ?? null;
			});
			const findActiveProvider = Effect.fn(function* (predicate: SQL) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select({
							id: schema.sandboxProvider.id,
							slug: schema.sandboxProvider.slug,
							name: schema.sandboxProvider.name,
							pluginId: schema.sandboxProvider.pluginId,
							createdAt: schema.sandboxProvider.createdAt,
							updatedAt: schema.sandboxProvider.updatedAt,
							information: schema.sandboxProvider.information,
							rootEntitySchemaSlug: schema.sandboxProvider.rootEntitySchemaSlug,
						})
						.from(schema.sandboxProvider)
						.innerJoin(schema.plugin, eq(schema.plugin.id, schema.sandboxProvider.pluginId))
						.innerJoin(
							schema.pluginRevision,
							eq(schema.pluginRevision.id, schema.plugin.activeRevisionId),
						)
						.where(and(activeSystemPlugin, declaresProvider, predicate))
						.orderBy(asc(schema.sandboxProvider.id))
						.limit(1),
				);
				return row ? { ...row, id: SandboxProviderId.make(row.id) } : null;
			});
			const findActiveProviderById = (id: SandboxProviderId) =>
				findActiveProvider(eq(schema.sandboxProvider.id, id));
			const findSchemaProviderBySlug = Effect.fn(function* (slug: string) {
				const provider = yield* findActiveProvider(eq(schema.sandboxProvider.slug, slug));
				return provider
					? { provider, entitySchemaSlug: EntitySchemaSlug.make(provider.rootEntitySchemaSlug) }
					: null;
			});
			const findAuthorizedSchemaProviderById = Effect.fn(function* (input: {
				pluginSlug: string;
				entitySchemaSlug: string;
				providerId: SandboxProviderId;
			}) {
				const provider = yield* findActiveProviderById(input.providerId);
				if (!provider || provider.rootEntitySchemaSlug !== input.entitySchemaSlug) {
					return null;
				}
				const db = yield* Database;
				const [owner] = yield* mapDatabaseErrors(
					db
						.select({ id: schema.globalEntitySchema.id })
						.from(schema.globalEntitySchema)
						.where(
							and(
								eq(schema.globalEntitySchema.pluginSlug, input.pluginSlug),
								eq(schema.globalEntitySchema.slug, input.entitySchemaSlug),
							),
						)
						.limit(1),
				);
				return owner
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
					const [revision] = yield* mapDatabaseErrors(
						db
							.select({ id: schema.pluginRevision.id, providers: manifestField("providers") })
							.from(schema.plugin)
							.innerJoin(
								schema.pluginRevision,
								eq(schema.pluginRevision.id, schema.plugin.activeRevisionId),
							)
							.where(eq(schema.plugin.id, provider.pluginId))
							.limit(1),
					);
					const definition = revision?.providers.find(({ slug }) => slug === provider.slug);
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
				listSchemaProviders,
				findActiveScriptById,
				findActiveProviderById,
				resolveActivePluginCron,
				listSystemCronSchedules,
				listPrivateCronSchedules,
				listSystemUserBootstraps,
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
				findKernelScript: repository.findKernelScript,
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
			PluginInstallationRepository.layer,
			PluginRepository.layer,
			PluginConfigRevisions.layer,
		),
	),
);
