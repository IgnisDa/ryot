import {
	type PluginConfigSchema,
	PluginManifest,
	PluginProviderOperation,
} from "@ryot-app/contract/modules/plugins/manifest";
import {
	type DeclarationReference,
	definitionOwnerPluginId,
	type EntitySchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import {
	EntitySchemaSlug,
	PluginId,
	type PluginPackageId,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { decodeStoredSchema } from "@ryot-app/contract/schema/core";
import type { PluginClientImport } from "@ryot-app/plugin-client-contract";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, asc, eq, isNull, type SQL, sql } from "drizzle-orm";
import { Context, Effect, Layer, Schema } from "effect";

import {
	type CatalogSandboxProvider,
	DefinitionCatalog,
	type UserPlugin,
} from "#modules/definitions/catalog";
import { userPluginQuery } from "#modules/definitions/catalog-relations";
import { referenceWhere } from "#platform/db/definition-owner";
import { DatabaseSession } from "#platform/db/session";
import * as schema from "#schema/tables/combined";

import { PluginConfigRevisions } from "../configuration/revisions";
import {
	type PluginInstallationHealth,
	PluginInstallationRepository,
} from "../installations/repository";
import { storedScriptFields } from "../packages/persisted-projections";
import { PluginRepository } from "../packages/repository";

export class UnsupportedProviderOperationError extends Schema.TaggedError<
	UnsupportedProviderOperationError,
	{ readonly brand: unique symbol }
>()("UnsupportedProviderOperationError", {
	providerId: SandboxProviderId,
	operation: PluginProviderOperation,
	providerSlug: Schema.NullOr(Schema.String),
	reason: Schema.Literals(["inactive_provider", "script_unavailable", "unsupported_operation"]),
}) {}

const AvailablePluginSections = Schema.Struct({
	client: PluginManifest.fields.client,
	workflows: PluginManifest.fields.workflows,
	operations: PluginManifest.fields.operations,
	metadata: Schema.Struct({ name: PluginManifest.fields.metadata.fields.name }),
});

export type AvailablePlugin = {
	readonly id: string;
	readonly isHidden: boolean;
	readonly contentHash: string;
	readonly installationId: string;
	readonly pluginRevisionId: string;
	readonly scope: "user" | "system";
	readonly packageId: PluginPackageId;
	readonly ownerUserId: null | UserId;
	readonly health: PluginInstallationHealth;
	readonly clientArtifactHash?: null | string;
	readonly pluginConfigRevisionId: null | string;
	readonly clientImports: readonly PluginClientImport[];
	readonly manifest: typeof AvailablePluginSections.Type;
	readonly compiledHashes: Readonly<Record<string, string>>;
};

export const CatalogDefinitionFingerprint = Schema.Struct({
	digest: Schema.String,
	pluginId: Schema.NullOr(PluginId),
});
export type CatalogDefinitionFingerprint = typeof CatalogDefinitionFingerprint.Type;

export const catalogDefinitionFingerprint = (definition: {
	readonly pluginId?: null | string | undefined;
}): CatalogDefinitionFingerprint => ({
	digest: sha256Base64Url(stableStringify(definition)),
	pluginId: definition.pluginId == null ? null : PluginId.make(definition.pluginId),
});

export const pluginConfigContextFor = (
	plugin: Pick<AvailablePlugin, "ownerUserId" | "pluginRevisionId" | "pluginConfigRevisionId">,
	configSchema: PluginConfigSchema,
) => ({
	configSchema,
	kind: "revision" as const,
	ownerUserId: plugin.ownerUserId,
	pluginRevisionId: plugin.pluginRevisionId,
	pluginConfigRevisionId: plugin.pluginConfigRevisionId,
});

const revisionSection = <Key extends "crons" | "userBootstrap">(key: Key) =>
	sql<PluginManifest[Key]>`${schema.pluginRevision[key]}`;

const activeSystemPlugin = and(eq(schema.plugin.status, "active"), isNull(schema.plugin.ownerId));

export const findRevisionScriptForSession = (database: DatabaseSession["Service"]) =>
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
	Effect.fn(function* <Key extends "crons" | "userBootstrap">(pluginId: string, key: Key) {
		const [row] = yield* database.run((db) =>
			db
				.select({ value: revisionSection(key), revisionId: schema.pluginRevision.id })
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
	Effect.fn(function* <Key extends "crons" | "userBootstrap">(key: Key) {
		return yield* database.run((db) =>
			db
				.select({
					pluginId: schema.plugin.id,
					value: revisionSection(key),
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
	"@ryot-app/kernel-backend/modules/plugins/catalog/runtime-resolver/PluginRuntimeResolver",
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
			const catalogs = yield* DefinitionCatalog;
			const lockCatalog = (userIds: ReadonlyArray<string>) =>
				repository.lockIngestionShared(userIds);

			const queryAvailablePlugins = Effect.fn(function* (
				userId: UserId,
				visibility: "listed" | "executable",
				filter: (plugin: UserPlugin) => boolean = () => true,
			) {
				const plugins = (yield* catalogs.userPlugins(userId)).filter(
					(plugin) =>
						(visibility === "listed" ? plugin.isListed : plugin.isExecutable) && filter(plugin),
				);
				if (plugins.length === 0) {
					return [];
				}
				const userPlugin = userPluginQuery(plugins).as("user_plugin");
				const rows = yield* database.run((db) =>
					db
						.select({
							id: userPlugin.pluginId,
							scope: userPlugin.scope,
							health: userPlugin.health,
							isHidden: userPlugin.isHidden,
							packageId: userPlugin.packageId,
							name: schema.pluginRevision.name,
							ownerUserId: userPlugin.ownerUserId,
							client: schema.pluginRevision.client,
							installationId: userPlugin.installationId,
							workflows: schema.pluginRevision.workflows,
							operations: schema.pluginRevision.operations,
							pluginRevisionId: userPlugin.activeRevisionId,
							contentHash: schema.pluginRevision.contentHash,
							pluginConfigRevisionId: userPlugin.configRevisionId,
							clientArtifactHash: schema.pluginRevision.clientArtifactHash,
							clientImports: sql<
								readonly PluginClientImport[]
							>`coalesce(${schema.clientArtifact.imports}, '[]'::jsonb)`,
							compiledHashes: sql<
								Record<string, string>
							>`coalesce((select jsonb_object_agg(s.slug, s.content_hash) from ${schema.sandboxScript} s where s.plugin_revision_id = ${userPlugin.activeRevisionId}), '{}'::jsonb)`,
						})
						.from(userPlugin)
						.innerJoin(
							schema.pluginRevision,
							eq(schema.pluginRevision.id, userPlugin.activeRevisionId),
						)
						.leftJoin(
							schema.clientArtifact,
							eq(schema.clientArtifact.hash, schema.pluginRevision.clientArtifactHash),
						),
				);
				const result = yield* Effect.forEach(
					rows,
					({ name, client, workflows, operations, ...row }) =>
						Effect.map(
							decodeStoredSchema(
								{ workflows, operations, metadata: { name }, ...(client ? { client } : {}) },
								AvailablePluginSections,
								`Plugin ${row.packageId} has an invalid retained manifest`,
							),
							(manifest): AvailablePlugin => ({
								...row,
								manifest,
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
			const resolveUserPackage = Effect.fn("PluginRuntimeResolver.resolveUserPackage")(function* (
				userId: UserId,
				packageId: PluginPackageId,
			) {
				const plugins = (yield* catalogs.userPlugins(userId)).filter(
					(plugin) => plugin.packageId === packageId,
				);
				const userPlugin = userPluginQuery(plugins).as("user_plugin");
				const rows = yield* database.run((db) =>
					db
						.select({
							scope: userPlugin.scope,
							health: userPlugin.health,
							pluginId: userPlugin.pluginId,
							incompatibilityReason: schema.pluginInstallation.incompatibilityReason,
						})
						.from(userPlugin)
						.innerJoin(
							schema.pluginInstallation,
							eq(schema.pluginInstallation.id, userPlugin.installationId),
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
					(candidate) => candidate.pluginId === pluginId,
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
				executingUserId: null | UserId,
			) {
				const userPlugin = userPluginQuery(
					executingUserId === null
						? []
						: (yield* catalogs.userPlugins(executingUserId)).filter(
								({ isExecutable }) => isExecutable,
							),
				).as("user_plugin");
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
								.from(userPlugin)
								.innerJoin(
									schema.sandboxScript,
									and(
										eq(schema.sandboxScript.id, scriptId),
										eq(schema.sandboxScript.pluginRevisionId, userPlugin.activeRevisionId),
									),
								)
								.innerJoin(schema.plugin, eq(schema.plugin.id, userPlugin.pluginId))
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
				if (!row || !bootstrap || !("scriptSlug" in bootstrap)) {
					return null;
				}
				const script = yield* findRevisionScript(row.revisionId, bootstrap.scriptSlug);
				return script ? { script, bootstrap } : null;
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
				const userPlugin = userPluginQuery(
					(yield* catalogs.listUserPlugins(sql`p.owner_user_id is not null`)).filter(
						({ scope, isExecutable }) => scope === "user" && isExecutable,
					),
				).as("user_plugin");
				const rows = yield* database.run((db) =>
					db
						.select({
							userId: userPlugin.userId,
							pluginId: userPlugin.pluginId,
							packageId: userPlugin.packageId,
							crons: schema.pluginRevision.crons,
							installationId: userPlugin.installationId,
						})
						.from(userPlugin)
						.innerJoin(
							schema.pluginRevision,
							eq(schema.pluginRevision.id, userPlugin.activeRevisionId),
						)
						.orderBy(asc(userPlugin.userId), asc(userPlugin.packageId)),
				);
				return rows.flatMap(({ crons, userId, ...row }) =>
					crons.map((cron) => ({ ...row, cron, userId: UserId.make(userId) })),
				);
			});
			const resolvePrivatePluginCron = Effect.fn(function* (input: {
				cronSlug: string;
				installationId: string;
			}) {
				const userPlugin = userPluginQuery(
					(yield* catalogs.listUserPlugins(sql`i.id = ${input.installationId}`)).filter(
						({ scope, isExecutable }) => scope === "user" && isExecutable,
					),
				).as("user_plugin");
				const [row] = yield* database.run((db) =>
					db
						.select({
							userId: userPlugin.userId,
							packageId: userPlugin.packageId,
							crons: schema.pluginRevision.crons,
							revisionId: userPlugin.activeRevisionId,
						})
						.from(userPlugin)
						.innerJoin(
							schema.pluginRevision,
							eq(schema.pluginRevision.id, userPlugin.activeRevisionId),
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
							userBootstrap: schema.pluginRevision.userBootstrap,
							scope: sql<
								"user" | "system"
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
						if ("entities" in entry) {
							return { slug: entry.slug, entities: entry.entities };
						}
						const script = yield* findRevisionScript(active.revisionId, entry.scriptSlug);
						return { slug: entry.slug, scriptId: script?.id ?? null };
					}),
				);
				return {
					entries,
					health: state.health,
					pluginId: state.pluginId,
					pluginScope: active.scope,
					installedAt: state.createdAt,
					activationId: active.activationId,
					userId: UserId.make(state.userId),
				};
			});
			const resolveUserInstallationBootstraps = Effect.fn(
				"PluginRuntimeResolver.resolveUserInstallationBootstraps",
			)(function* (userId: UserId) {
				const rows = yield* database.run((db) =>
					db
						.select({
							activationId: schema.plugin.activationId,
							health: schema.pluginInstallation.health,
							pluginId: schema.pluginInstallation.pluginId,
							isHidden: schema.pluginInstallation.isHidden,
							installationId: schema.pluginInstallation.id,
							installedAt: schema.pluginInstallation.createdAt,
							userBootstrap: schema.pluginRevision.userBootstrap,
							scriptIds: sql<
								Record<string, string>
							>`coalesce((select jsonb_object_agg(s.slug, s.id) from ${schema.sandboxScript} s where s.plugin_revision_id = ${schema.pluginRevision.id} and s.slug in (select entry->>'scriptSlug' from jsonb_array_elements(${schema.pluginRevision.userBootstrap}) entry)), '{}'::jsonb)`,
						})
						.from(schema.pluginInstallation)
						.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginInstallation.pluginId))
						.innerJoin(
							schema.pluginRevision,
							eq(schema.pluginRevision.id, schema.plugin.activeRevisionId),
						)
						.where(
							and(
								activeSystemPlugin,
								isNull(schema.pluginInstallation.uninstalledAt),
								eq(schema.pluginInstallation.userId, userId),
							),
						)
						.orderBy(asc(schema.pluginInstallation.sortOrder), asc(schema.plugin.packageId)),
				);
				return rows.map(
					({
						health,
						isHidden,
						pluginId,
						scriptIds,
						installedAt,
						activationId,
						userBootstrap,
						installationId,
					}) => ({
						health,
						isHidden,
						pluginId,
						installedAt,
						activationId,
						installationId,
						entries: userBootstrap.map((entry) => {
							if ("entities" in entry) {
								return { slug: entry.slug, entities: entry.entities };
							}
							const scriptId = scriptIds[entry.scriptSlug];
							return {
								slug: entry.slug,
								scriptId: scriptId ? SandboxScriptId.make(scriptId) : null,
							};
						}),
					}),
				);
			});
			const querySchemaProviders = Effect.fn(function* (
				userId: UserId,
				filter: (provider: CatalogSandboxProvider) => boolean = () => true,
			) {
				const { providers } = yield* catalogs.sandboxProviders(yield* catalogs.forUser(userId));
				const rows = providers
					.filter(filter)
					.map((provider) => ({
						id: provider.id,
						slug: provider.slug,
						name: provider.name,
						pluginId: provider.pluginId,
						createdAt: provider.createdAt,
						updatedAt: provider.updatedAt,
						pluginScope: provider.pluginScope,
						information: provider.information,
						rootEntitySchemaSlug: provider.rootEntitySchemaSlug,
					}));
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
				entitySchemas?: ReadonlyArray<EntitySchemaReference>;
			}) {
				if (input.entitySchemas?.length === 0) {
					return [];
				}
				const references = input.entitySchemas;
				return yield* querySchemaProviders(input.userId, (provider) =>
					references
						? references.some(
								(reference) =>
									provider.rootEntitySchemaSlug === reference.slug &&
									provider.pluginId === definitionOwnerPluginId(reference.owner),
							)
						: true,
				);
			});
			const findProviderAvailableToUser = Effect.fn(function* (
				userId: UserId,
				id: SandboxProviderId,
			) {
				const [row] = yield* querySchemaProviders(userId, (provider) => provider.id === id);
				return row?.provider ?? null;
			});
			const findProviderAvailableToUserByReference = Effect.fn(function* (
				userId: UserId,
				reference: DeclarationReference,
			) {
				const [row] = yield* querySchemaProviders(
					userId,
					(provider) =>
						provider.slug === reference.slug &&
						provider.pluginId === definitionOwnerPluginId(reference.owner),
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
							schema.definitionProvider,
							and(
								eq(schema.definitionProvider.pluginRevisionId, schema.plugin.activeRevisionId),
								eq(schema.definitionProvider.slug, schema.sandboxProvider.slug),
							),
						)
						.innerJoin(
							schema.definitionEntitySchema,
							and(
								eq(schema.definitionEntitySchema.pluginRevisionId, schema.plugin.activeRevisionId),
								eq(schema.definitionEntitySchema.slug, schema.sandboxProvider.rootEntitySchemaSlug),
							),
						)
						.where(and(activeSystemPlugin, predicate))
						.orderBy(asc(schema.sandboxProvider.id))
						.limit(1),
				);
				return row ? { ...row, id: SandboxProviderId.make(row.id) } : null;
			});
			const findActiveProviderById = (id: SandboxProviderId) =>
				findActiveProvider(eq(schema.sandboxProvider.id, id));
			const findSchemaProviderByReference = Effect.fn(function* (reference: DeclarationReference) {
				const provider = yield* findActiveProvider(
					referenceWhere(schema.sandboxProvider, reference),
				);
				return provider
					? { provider, entitySchemaSlug: EntitySchemaSlug.make(provider.rootEntitySchemaSlug) }
					: null;
			});
			const findAuthorizedSchemaProviderById = Effect.fn(function* (input: {
				providerId: SandboxProviderId;
				entitySchema: EntitySchemaReference;
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
						.select({ id: schema.definitionEntitySchema.id })
						.from(schema.plugin)
						.innerJoin(
							schema.definitionEntitySchema,
							eq(schema.definitionEntitySchema.pluginRevisionId, schema.plugin.activeRevisionId),
						)
						.where(
							and(
								activeSystemPlugin,
								eq(schema.plugin.id, pluginId),
								eq(schema.definitionEntitySchema.slug, input.entitySchema.slug),
							),
						)
						.limit(1),
				);
				return owner ? { provider, entitySchemaSlug: input.entitySchema.slug } : null;
			});
			const resolveProviderOperation = (
				operation: PluginProviderOperation,
				userId: null | UserId,
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
					const [definition] = yield* database.run((db) =>
						db
							.select({
								revisionId: schema.definitionProvider.pluginRevisionId,
								scriptSlug: schema.definitionProviderOperation.scriptSlug,
								rootEntitySchemaSlug: schema.definitionProvider.rootEntitySchemaSlug,
							})
							.from(schema.plugin)
							.innerJoin(
								schema.definitionProvider,
								and(
									eq(schema.definitionProvider.pluginRevisionId, schema.plugin.activeRevisionId),
									eq(schema.definitionProvider.slug, provider.slug),
								),
							)
							.leftJoin(
								schema.definitionProviderOperation,
								and(
									eq(
										schema.definitionProviderOperation.pluginRevisionId,
										schema.definitionProvider.pluginRevisionId,
									),
									eq(
										schema.definitionProviderOperation.providerSlug,
										schema.definitionProvider.slug,
									),
									eq(schema.definitionProviderOperation.operation, operation),
								),
							)
							.where(eq(schema.plugin.id, provider.pluginId))
							.limit(1),
					);
					const scriptSlug = definition?.scriptSlug;
					const script =
						definition && scriptSlug
							? yield* findRevisionScript(definition.revisionId, scriptSlug)
							: null;
					if (
						definition?.rootEntitySchemaSlug !== provider.rootEntitySchemaSlug ||
						script?.metadata.kind !== "provider" ||
						script.providerId !== providerId ||
						script.pluginRevisionId !== definition.revisionId
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
			const resolveConfigKeyLabels = Effect.fn(function* (
				pluginRevisionId: null | string,
				keys: ReadonlyArray<string>,
			) {
				const [row] =
					pluginRevisionId === null
						? []
						: yield* database.run((db) =>
								db
									.select({ configSchema: schema.pluginRevision.configSchema })
									.from(schema.pluginRevision)
									.where(eq(schema.pluginRevision.id, pluginRevisionId))
									.limit(1),
							);
				return keys.map((key) => row?.configSchema.fields[key]?.label ?? key);
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
				resolveConfigKeyLabels,
				resolveActivePluginCron,
				listSystemCronSchedules,
				listPrivateCronSchedules,
				listSystemUserBootstraps,
				resolvePrivatePluginCron,
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
				resolveUserInstallationBootstraps,
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
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(DefinitionCatalog.layer),
	);
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
