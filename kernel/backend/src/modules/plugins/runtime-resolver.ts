import type { PluginClientImport } from "@ryot-app/client-plugin-contract";
import type {
	PluginManifest,
	PluginProviderOperation,
} from "@ryot-app/contract/modules/plugins/manifest";
import {
	definitionOwner,
	type EntitySchemaReference,
	type ProviderReference,
} from "@ryot-app/contract/modules/plugins/references";
import {
	EntitySchemaSlug,
	PluginId,
	type PluginPackageId,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, asc, eq, exists, isNull, or, sql, type SQL } from "drizzle-orm";
import { Context, Data, Effect, Layer, Schema } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";

import { PluginConfigRevisions } from "./config-revisions";
import {
	PluginInstallationRepository,
	type PluginInstallationHealth,
	type PluginInstallationState,
} from "./installation-repository";
import { storedScriptFields } from "./persisted-projections";
import { decodeStoredManifest, PluginRepository } from "./repository";
import { PluginValidationError } from "./validation";

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
	readonly packageId: PluginPackageId;
	readonly sourceHash: string;
	readonly clientArtifactHash?: string | null;
	readonly clientImports: readonly PluginClientImport[];
	readonly pluginRevisionId: string;
	readonly pluginConfigRevisionId: string | null;
	readonly isHidden: boolean;
	readonly installationId: string;
	readonly scope: "system" | "user";
	readonly ownerUserId: UserId | null;
	readonly manifest: PluginManifest;
	readonly health: PluginInstallationHealth;
	readonly healthReason: string | null;
	readonly incompatibilityReason: PluginInstallationState["incompatibilityReason"];
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

const activeSystemPlugin = and(eq(schema.plugin.status, "active"), isNull(schema.plugin.ownerId));

const declaresProvider = exists(
	sql`(select 1 from jsonb_array_elements(${schema.pluginRevision.manifest} -> 'providers') m where m ->> 'slug' = ${schema.sandboxProvider.slug})`,
);

const findRevisionScriptForSession = (database: DatabaseSession["Service"]) =>
	Effect.fn(function* (pluginRevisionId: string, scriptSlug: string) {
		const [row] = yield* database.run((db) =>
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

const findSystemManifestFieldForSession = (database: DatabaseSession["Service"]) =>
	Effect.fn(function* <Key extends keyof PluginManifest>(pluginId: string, key: Key) {
		const [row] = yield* database.run((db) =>
			db
				.select({ value: manifestField(key), revisionId: schema.pluginRevision.id })
				.from(schema.plugin)
				.innerJoin(
					schema.pluginRevision,
					eq(schema.pluginRevision.id, schema.plugin.activeRevisionId),
				)
				.where(and(activeSystemPlugin, eq(schema.plugin.id, pluginId)))
				.limit(1),
		);
		return row ?? null;
	});

const listSystemManifestFieldForSession = (database: DatabaseSession["Service"]) =>
	Effect.fn(function* <Key extends keyof PluginManifest>(key: Key) {
		return yield* database.run((db) =>
			db
				.select({
					value: manifestField(key),
					pluginId: schema.plugin.id,
					packageId: schema.plugin.packageId,
				})
				.from(schema.plugin)
				.innerJoin(
					schema.pluginRevision,
					eq(schema.pluginRevision.id, schema.plugin.activeRevisionId),
				)
				.where(activeSystemPlugin),
		);
	});

const byPackageAndSlug = <Entry extends { readonly packageId: PluginPackageId }>(
	entries: Array<Entry>,
	slug: (entry: Entry) => string,
) =>
	entries.sort(
		(left, right) =>
			left.packageId.localeCompare(right.packageId) || slug(left).localeCompare(slug(right)),
	);

export class PluginRuntimeResolver extends Context.Service<PluginRuntimeResolver>()(
	"PluginRuntimeResolver",
	{
		make: Effect.gen(function* () {
			const database = yield* DatabaseSession;
			const findRevisionScript = findRevisionScriptForSession(database);
			const findSystemManifestField = findSystemManifestFieldForSession(database);
			const listSystemManifestField = listSystemManifestFieldForSession(database);
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
			const installations = yield* PluginInstallationRepository;
			const repository = yield* PluginRepository;
			const configs = yield* PluginConfigRevisions;
			const lockCatalog = repository.lockIngestionShared;

			const queryAvailablePlugins = Effect.fn(function* (
				userId: UserId,
				visibility: "executable" | "listed",
				predicate?: SQL,
			) {
				const rows = yield* database.run((db) =>
					db
						.select({
							id: schema.userPlugin.pluginId,
							scope: schema.userPlugin.scope,
							health: schema.userPlugin.health,
							isHidden: schema.userPlugin.isHidden,
							packageId: schema.userPlugin.packageId,
							manifest: schema.pluginRevision.manifest,
							ownerUserId: schema.userPlugin.ownerUserId,
							sourceHash: schema.pluginRevision.sourceHash,
							installationId: schema.userPlugin.installationId,
							healthReason: schema.pluginInstallation.healthReason,
							pluginRevisionId: schema.userPlugin.activeRevisionId,
							pluginConfigRevisionId: schema.userPlugin.configRevisionId,
							clientArtifactHash: schema.pluginRevision.clientArtifactHash,
							incompatibilityReason: schema.pluginInstallation.incompatibilityReason,
							clientImports: sql<
								readonly PluginClientImport[]
							>`coalesce(${schema.clientArtifact.imports}, '[]'::jsonb)`,
							compiledHashes: sql<
								Record<string, string>
							>`coalesce((select jsonb_object_agg(s.slug, s.content_hash) from ${schema.sandboxScript} s where s.plugin_revision_id = ${schema.userPlugin.activeRevisionId}), '{}'::jsonb)`,
						})
						.from(schema.userPlugin)
						.innerJoin(
							schema.pluginInstallation,
							eq(schema.pluginInstallation.id, schema.userPlugin.installationId),
						)
						.innerJoin(
							schema.pluginRevision,
							eq(schema.pluginRevision.id, schema.userPlugin.activeRevisionId),
						)
						.leftJoin(
							schema.clientArtifact,
							eq(schema.clientArtifact.hash, schema.pluginRevision.clientArtifactHash),
						)
						.where(
							and(
								eq(schema.userPlugin.userId, userId),
								visibility === "listed"
									? eq(schema.userPlugin.isListed, true)
									: eq(schema.userPlugin.isExecutable, true),
								predicate,
							),
						),
				);
				const result = yield* Effect.forEach(rows, (row) =>
					Effect.map(
						decodeStoredManifest(row.manifest, row.packageId).pipe(
							Effect.tap((manifest) =>
								manifest.metadata.packageId === row.packageId
									? Effect.void
									: Effect.fail(
											new PluginValidationError({
												issues: ["Persisted plugin package identity does not match its manifest"],
											}),
										),
							),
						),
						(manifest): AvailablePlugin => ({
							...row,
							manifest,
							packageId: manifest.metadata.packageId,
							ownerUserId: row.ownerUserId ? UserId.make(row.ownerUserId) : null,
						}),
					),
				);
				return result.sort((a, b) => a.packageId.localeCompare(b.packageId));
			});

			const listPluginsAvailableToUser = Effect.fn(
				"PluginRuntimeResolver.listPluginsAvailableToUser",
			)((userId: UserId, listed = false) =>
				queryAvailablePlugins(userId, listed ? "listed" : "executable"),
			);
			const listPluginsForManagement = Effect.fn("PluginRuntimeResolver.listPluginsForManagement")(
				function* (userId: UserId) {
					const rows = yield* database.run((db) =>
						db
							.select({
								id: schema.plugin.id,
								packageId: schema.plugin.packageId,
								ownerUserId: schema.plugin.ownerId,
								health: schema.pluginInstallation.health,
								manifest: schema.pluginRevision.manifest,
								pluginRevisionId: schema.pluginRevision.id,
								isHidden: schema.pluginInstallation.isHidden,
								installationId: schema.pluginInstallation.id,
								sourceHash: schema.pluginRevision.sourceHash,
								healthReason: schema.pluginInstallation.healthReason,
								clientArtifactHash: schema.pluginRevision.clientArtifactHash,
								incompatibilityReason: schema.pluginInstallation.incompatibilityReason,
								scope: sql<
									"system" | "user"
								>`case when ${schema.plugin.ownerId} is null then 'system' else 'user' end`,
								clientImports: sql<
									readonly PluginClientImport[]
								>`coalesce(${schema.clientArtifact.imports}, '[]'::jsonb)`,
								pluginConfigRevisionId: sql<
									string | null
								>`case when ${schema.plugin.ownerId} is null then ${schema.plugin.environmentConfigRevisionId} else ${schema.pluginInstallation.activeConfigRevisionId} end`,
								compiledHashes: sql<
									Record<string, string>
								>`coalesce((select jsonb_object_agg(s.slug, s.content_hash) from ${schema.sandboxScript} s where s.plugin_revision_id = ${schema.pluginRevision.id}), '{}'::jsonb)`,
							})
							.from(schema.pluginInstallation)
							.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginInstallation.pluginId))
							.innerJoin(
								schema.pluginRevision,
								eq(schema.pluginRevision.id, schema.plugin.activeRevisionId),
							)
							.leftJoin(
								schema.clientArtifact,
								eq(schema.clientArtifact.hash, schema.pluginRevision.clientArtifactHash),
							)
							.where(
								and(
									eq(schema.pluginInstallation.userId, userId),
									isNull(schema.pluginInstallation.uninstalledAt),
									or(isNull(schema.plugin.ownerId), eq(schema.plugin.ownerId, userId)),
								),
							),
					);
					return yield* Effect.forEach(rows, (row) =>
						decodeStoredManifest(row.manifest, row.packageId).pipe(
							Effect.tap((manifest) =>
								manifest.metadata.packageId === row.packageId
									? Effect.void
									: Effect.fail(
											new PluginValidationError({
												issues: ["Persisted plugin package identity does not match its manifest"],
											}),
										),
							),
							Effect.map((manifest): AvailablePlugin => ({
								...row,
								manifest,
								packageId: manifest.metadata.packageId,
								ownerUserId: row.ownerUserId === null ? null : UserId.make(row.ownerUserId),
							})),
						),
					);
				},
			);
			const resolveUserPackage = Effect.fn("PluginRuntimeResolver.resolveUserPackage")(function* (
				userId: UserId,
				packageId: PluginPackageId,
			) {
				const rows = yield* database.run((db) =>
					db
						.select({
							scope: schema.userPlugin.scope,
							health: schema.userPlugin.health,
							pluginId: schema.userPlugin.pluginId,
							incompatibilityReason: schema.pluginInstallation.incompatibilityReason,
						})
						.from(schema.userPlugin)
						.innerJoin(
							schema.pluginInstallation,
							eq(schema.pluginInstallation.id, schema.userPlugin.installationId),
						)
						.where(
							and(eq(schema.userPlugin.userId, userId), eq(schema.userPlugin.packageId, packageId)),
						),
				);
				const isQuarantined = (row: (typeof rows)[number]) =>
					row.health === "incompatible" &&
					row.incompatibilityReason === "package-identity-conflict";
				const effective = rows.filter((row) => !isQuarantined(row));
				if (effective.length > 1) {
					return yield* Effect.die(
						new Error(`User ${userId} has multiple effective installations of ${packageId}`),
					);
				}
				const [selected] = effective;
				if (selected) {
					return { kind: "effective" as const, pluginId: PluginId.make(selected.pluginId) };
				}
				const quarantined = rows.find((row) => row.scope === "user" && isQuarantined(row));
				return quarantined
					? { kind: "quarantined" as const, pluginId: PluginId.make(quarantined.pluginId) }
					: { kind: "absent" as const };
			});
			const findPluginAvailableToUser = Effect.fn(function* (userId: UserId, pluginId: string) {
				const [plugin] = yield* queryAvailablePlugins(
					userId,
					"executable",
					eq(schema.userPlugin.pluginId, pluginId),
				);
				return plugin ?? null;
			});
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
				pluginId: string;
				operationSlug: string;
			}) {
				const plugin = yield* findPluginAvailableToUser(input.userId, input.pluginId);
				const operation = plugin?.manifest.operations.find(
					({ slug }) => slug === input.operationSlug,
				);
				const script =
					plugin && operation
						? yield* findScriptInAvailablePlugin(plugin, operation.scriptSlug)
						: null;
				return plugin && operation && script?.metadata.kind === "operation"
					? { plugin, script, operation }
					: null;
			});
			const findActiveScriptById = Effect.fn(function* (
				scriptId: SandboxScriptId,
				executingUserId: UserId | null,
			) {
				const [row] = yield* executingUserId === null
					? database.run((db) =>
							db
								.select(storedScriptFields)
								.from(schema.sandboxScript)
								.innerJoin(
									schema.plugin,
									eq(schema.plugin.activeRevisionId, schema.sandboxScript.pluginRevisionId),
								)
								.where(and(eq(schema.sandboxScript.id, scriptId), activeSystemPlugin))
								.limit(1),
						)
					: database.run((db) =>
							db
								.select(storedScriptFields)
								.from(schema.userPlugin)
								.innerJoin(
									schema.sandboxScript,
									and(
										eq(schema.sandboxScript.id, scriptId),
										eq(schema.sandboxScript.pluginRevisionId, schema.userPlugin.activeRevisionId),
									),
								)
								.innerJoin(schema.plugin, eq(schema.plugin.id, schema.userPlugin.pluginId))
								.where(
									and(
										eq(schema.userPlugin.userId, executingUserId),
										eq(schema.userPlugin.isExecutable, true),
									),
								)
								.limit(1),
						);
				return row ? { ...row, id: SandboxScriptId.make(row.id) } : null;
			});
			const resolveActivePluginCron = Effect.fn(function* (input: {
				pluginId: string;
				cronSlug: string;
			}) {
				const row = yield* findSystemManifestField(input.pluginId, "crons");
				const cron = row?.value.find(({ slug }) => slug === input.cronSlug);
				const script =
					row && cron ? yield* findRevisionScript(row.revisionId, cron.scriptSlug) : null;
				return cron && script ? { cron, script } : null;
			});
			const resolveActivePluginUserBootstrap = Effect.fn(function* (input: {
				pluginId: string;
				bootstrapSlug: string;
			}) {
				const row = yield* findSystemManifestField(input.pluginId, "userBootstrap");
				const bootstrap = row?.value.find(({ slug }) => slug === input.bootstrapSlug);
				const script =
					row && bootstrap ? yield* findRevisionScript(row.revisionId, bootstrap.scriptSlug) : null;
				return bootstrap && script ? { script, bootstrap } : null;
			});
			const listSystemCronSchedules = Effect.fn(function* () {
				const rows = yield* listSystemManifestField("crons");
				return byPackageAndSlug(
					rows.flatMap(({ value, pluginId, packageId }) =>
						value.map((cron) => ({ cron, pluginId, packageId })),
					),
					({ cron }) => cron.slug,
				);
			});
			const listSystemUserBootstraps = Effect.fn(function* () {
				const rows = yield* listSystemManifestField("userBootstrap");
				return byPackageAndSlug(
					rows.flatMap(({ value, pluginId, packageId }) =>
						value.map((bootstrap) => ({ pluginId, bootstrap, packageId })),
					),
					({ bootstrap }) => bootstrap.slug,
				);
			});
			const listPrivateCronSchedules = Effect.fn(function* () {
				const rows = yield* database.run((db) =>
					db
						.select({
							crons: manifestField("crons"),
							userId: schema.userPlugin.userId,
							pluginId: schema.userPlugin.pluginId,
							installationId: schema.userPlugin.installationId,
							packageId: sql<PluginPackageId>`${schema.userPlugin.packageId}`,
						})
						.from(schema.userPlugin)
						.innerJoin(
							schema.pluginRevision,
							eq(schema.pluginRevision.id, schema.userPlugin.activeRevisionId),
						)
						.where(
							and(eq(schema.userPlugin.scope, "user"), eq(schema.userPlugin.isExecutable, true)),
						)
						.orderBy(asc(schema.userPlugin.userId), asc(schema.userPlugin.packageId)),
				);
				return rows.flatMap(({ crons, userId, ...row }) =>
					crons.map((cron) => ({ ...row, cron, userId: UserId.make(userId) })),
				);
			});
			const resolvePrivatePluginCron = Effect.fn(function* (input: {
				installationId: string;
				cronSlug: string;
			}) {
				const [row] = yield* database.run((db) =>
					db
						.select({
							crons: manifestField("crons"),
							userId: schema.userPlugin.userId,
							revisionId: schema.userPlugin.activeRevisionId,
							packageId: sql<PluginPackageId>`${schema.userPlugin.packageId}`,
						})
						.from(schema.userPlugin)
						.innerJoin(
							schema.pluginRevision,
							eq(schema.pluginRevision.id, schema.userPlugin.activeRevisionId),
						)
						.where(
							and(
								eq(schema.userPlugin.installationId, input.installationId),
								eq(schema.userPlugin.scope, "user"),
								eq(schema.userPlugin.isExecutable, true),
							),
						)
						.limit(1),
				);
				const cron = row?.crons.find(({ slug }) => slug === input.cronSlug);
				const script =
					row && cron ? yield* findRevisionScript(row.revisionId, cron.scriptSlug) : null;
				return row && cron && script
					? { cron, script, packageId: row.packageId, userId: UserId.make(row.userId) }
					: null;
			});
			const resolveInstallationBootstrap = Effect.fn(function* (installationId: string) {
				const state = yield* installations.findById(installationId);
				if (!state) {
					return null;
				}
				const [active] = yield* database.run((db) =>
					db
						.select({
							revisionId: schema.pluginRevision.id,
							activationId: schema.plugin.activationId,
							userBootstrap: manifestField("userBootstrap"),
							scope: sql<
								"system" | "user"
							>`case when ${schema.plugin.ownerId} is null then 'system' else 'user' end`,
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
					activationId: active.activationId,
					userId: UserId.make(state.userId),
				};
			});
			const querySchemaProviders = Effect.fn(function* (userId: UserId, predicate?: SQL) {
				const rows = yield* database.run((db) =>
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
						entitySchema: {
							owner: definitionOwner(row.pluginId),
							slug: EntitySchemaSlug.make(row.rootEntitySchemaSlug),
						},
					}))
					.sort(
						(left, right) =>
							left.entitySchemaSlug.localeCompare(right.entitySchemaSlug) ||
							left.provider.slug.localeCompare(right.provider.slug),
					);
			});
			const listSchemaProviders = Effect.fn(function* (input: {
				userId: UserId;
				entitySchemas?: ReadonlyArray<EntitySchemaReference>;
			}) {
				if (input.entitySchemas?.length === 0) {
					return [];
				}
				return yield* querySchemaProviders(
					input.userId,
					input.entitySchemas
						? or(
								...input.entitySchemas.map(({ slug, owner }) =>
									owner.kind === "plugin"
										? and(
												eq(schema.userSandboxProvider.pluginId, owner.pluginId),
												eq(schema.userSandboxProvider.rootEntitySchemaSlug, slug),
											)
										: sql`false`,
								),
							)
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
			const findProviderAvailableToUserByReference = Effect.fn(function* (
				userId: UserId,
				reference: ProviderReference,
			) {
				if (reference.owner.kind === "kernel") {
					return null;
				}
				const [row] = yield* querySchemaProviders(
					userId,
					and(
						eq(schema.userSandboxProvider.slug, reference.slug),
						eq(schema.userSandboxProvider.pluginId, reference.owner.pluginId),
					),
				);
				return row?.provider ?? null;
			});
			const findActiveProvider = Effect.fn(function* (predicate: SQL | undefined) {
				const [row] = yield* database.run((db) =>
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
						.innerJoin(
							schema.globalEntitySchema,
							and(
								eq(schema.globalEntitySchema.pluginId, schema.sandboxProvider.pluginId),
								eq(schema.globalEntitySchema.slug, schema.sandboxProvider.rootEntitySchemaSlug),
							),
						)
						.where(and(activeSystemPlugin, declaresProvider, predicate))
						.orderBy(asc(schema.sandboxProvider.id))
						.limit(1),
				);
				return row ? { ...row, id: SandboxProviderId.make(row.id) } : null;
			});
			const findActiveProviderById = (id: SandboxProviderId) =>
				findActiveProvider(eq(schema.sandboxProvider.id, id));
			const findSchemaProviderByReference = Effect.fn(function* (reference: ProviderReference) {
				if (reference.owner.kind === "kernel") {
					return null;
				}
				const provider = yield* findActiveProvider(
					and(
						eq(schema.sandboxProvider.slug, reference.slug),
						eq(schema.sandboxProvider.pluginId, reference.owner.pluginId),
					),
				);
				return provider
					? { provider, entitySchemaSlug: EntitySchemaSlug.make(provider.rootEntitySchemaSlug) }
					: null;
			});
			const findAuthorizedSchemaProviderById = Effect.fn(function* (input: {
				entitySchema: EntitySchemaReference;
				providerId: SandboxProviderId;
			}) {
				const provider = yield* findActiveProviderById(input.providerId);
				if (
					!provider ||
					input.entitySchema.owner.kind !== "plugin" ||
					provider.pluginId !== input.entitySchema.owner.pluginId ||
					provider.rootEntitySchemaSlug !== input.entitySchema.slug
				) {
					return null;
				}
				const pluginId = input.entitySchema.owner.pluginId;
				const [owner] = yield* database.run((db) =>
					db
						.select({ id: schema.globalEntitySchema.id })
						.from(schema.globalEntitySchema)
						.where(
							and(
								eq(schema.globalEntitySchema.pluginId, pluginId),
								eq(schema.globalEntitySchema.slug, input.entitySchema.slug),
							),
						)
						.limit(1),
				);
				return owner ? { provider, entitySchemaSlug: input.entitySchema.slug } : null;
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
					const [revision] = yield* database.run((db) =>
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
					if (
						definition?.rootEntitySchemaSlug !== provider.rootEntitySchemaSlug ||
						script?.metadata.kind !== "provider" ||
						script.providerId !== providerId ||
						script.pluginRevisionId !== revision?.id
					) {
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
				resolveUserPackage,
				listSchemaProviders,
				findActiveScriptById,
				findActiveProviderById,
				resolveActivePluginCron,
				listSystemCronSchedules,
				listPrivateCronSchedules,
				listSystemUserBootstraps,
				resolvePrivatePluginCron,
				listPluginsForManagement,
				findPluginAvailableToUser,
				findScriptAvailableToUser,
				listPluginsAvailableToUser,
				findScriptInAvailablePlugin,
				findProviderAvailableToUser,
				findOperationAvailableToUser,
				resolveInstallationBootstrap,
				findSchemaProviderByReference,
				resolveActivePluginUserBootstrap,
				findAuthorizedSchemaProviderById,
				findWorkflowScriptAvailableToUser,
				findWorkflowScriptInAvailablePlugin,
				findProviderAvailableToUserByReference,
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
