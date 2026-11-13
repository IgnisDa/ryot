import {
	dataJsonImportInputSchema,
	dataJsonIntegrationSettingsSchema,
} from "@ryot-app/contract/modules/imports/data-json";
import type { PluginPackageReference } from "@ryot-app/contract/modules/plugins/references";
import { mapPluginIdentityReferences } from "@ryot-app/contract/modules/ryotql/authored";
import { PluginId, type PluginPackageId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { and, asc, eq, getTableColumns, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { Context, Effect, Layer, Result } from "effect";

import { DatabaseSession } from "#platform/db/session";
import * as schema from "#schema/tables/combined";

export type PluginScope = "user" | "system";

export type CatalogImportSource = Executable & ImportSourceRow;

export type CatalogSavedView = Owner & Effective & SavedViewRow;

export type CatalogEventSchema = Owner & Effective & EventSchemaRow;

export type CatalogEntitySchema = Owner & Effective & EntitySchemaRow;

export type CatalogSignalSchema = Owner & Effective & SignalSchemaRow;

export type CatalogIntegrationProvider = Executable & IntegrationProviderRow;
export type CatalogRelationshipSchema = Owner & Effective & RelationshipSchemaRow;
export type CatalogCalendarSource = Effective &
	CalendarSourceRow & {
		readonly pluginId: string;
		readonly pluginScope: PluginScope;
		readonly packageId: PluginPackageId;
	};
export type CatalogSandboxProvider = typeof schema.sandboxProvider.$inferSelect & {
	readonly userId: string;
	readonly installationId: string;
	readonly pluginScope: PluginScope;
	readonly packageId: PluginPackageId;
};
export type CatalogSandboxProviderOperation = {
	readonly userId: string;
	readonly pluginId: string;
	readonly operation: string;
	readonly providerId: string;
	readonly packageId: PluginPackageId;
	readonly optionsSchema: null | AppSchema;
};
export type UserCatalog = DefinitionCatalogRows & {
	readonly userId: string;
	readonly plugins: ReadonlyArray<UserPlugin>;
	readonly revisions: ReadonlyMap<string, RevisionCatalog>;
	readonly importSources: ReadonlyArray<CatalogImportSource>;
	readonly integrationProviders: ReadonlyArray<CatalogIntegrationProvider>;
};
export const isReadyPackage =
	(reference: PluginPackageReference) =>
	(plugin: UserPlugin): boolean =>
		plugin.packageId === reference.packageId &&
		plugin.scope === reference.scope &&
		plugin.health === "ready" &&
		plugin.isDefinitionEffective &&
		plugin.isExecutable;

export type UserPlugin = {
	readonly userId: string;
	readonly pluginId: string;
	readonly isHidden: boolean;
	readonly isListed: boolean;
	readonly sortOrder: number;
	readonly scope: PluginScope;
	readonly isExecutable: boolean;
	readonly installationId: string;
	readonly activeRevisionId: string;
	readonly ownerUserId: null | string;
	readonly packageId: PluginPackageId;
	readonly health: InstallationHealth;
	readonly isDefinitionEffective: boolean;
	readonly configRevisionId: null | string;
};
type Effective = { readonly isEffective: boolean };
type ProviderRow = typeof schema.definitionProvider.$inferSelect;
type SavedViewRow = typeof schema.definitionSavedView.$inferSelect;

type EntitySchemaRow = typeof schema.definitionEntitySchema.$inferSelect;
type SignalSchemaRow = typeof schema.definitionSignalSchema.$inferSelect;
type CalendarSourceRow = typeof schema.definitionCalendarSource.$inferSelect;
type InstallationHealth = (typeof schema.pluginInstallation.$inferSelect)["health"];
type RelationshipSchemaRow = typeof schema.definitionRelationshipSchema.$inferSelect;
type GlobalCatalog = DefinitionCatalogRows & { readonly plugins: ReadonlyArray<GlobalPlugin> };

/** Every user's catalog: kernel rows apply to all users, and each user's catalog holds only plugin rows. */
type AllUsersCatalog = { readonly kernel: UserCatalog; readonly users: ReadonlyArray<UserCatalog> };

type RevisionSections = Pick<
	typeof schema.pluginRevision.$inferSelect,
	"hooks" | "scripts" | "queries" | "signalSchemas"
>;

type Owner = {
	readonly pluginId: null | string;
	readonly pluginScope: null | PluginScope;
	readonly packageId: null | PluginPackageId;
};

type Executable = Owner & {
	readonly userId: string;
	readonly installationId: null | string;
	readonly configRevisionId: null | string;
};
type EventSchemaRow = typeof schema.definitionEventSchema.$inferSelect & {
	readonly entitySchemaSlug: string;
	readonly pluginRevisionId: null | string;
};

type ImportSourceRow = Omit<
	typeof schema.definitionImportSource.$inferSelect,
	"pluginRevisionId"
> & { readonly workflowScriptId: null | string; readonly pluginRevisionId: null | string };

type IntegrationProviderRow = {
	readonly scriptId: null | string;
	readonly pluginRevisionId: null | string;
} & Omit<typeof schema.definitionIntegrationProvider.$inferSelect, "pluginRevisionId">;

type GlobalPlugin = {
	readonly pluginId: string;
	readonly isExecutable: boolean;
	readonly activeRevisionId: string;
	readonly packageId: PluginPackageId;
	readonly configRevisionId: null | string;
};

type ProviderOperationRow = typeof schema.definitionProviderOperation.$inferSelect & {
	readonly script: null | {
		readonly id: string;
		readonly kind: null | string;
		readonly providerId: null | string;
		readonly providerOperation: null | string;
		readonly searchOptionsSchema: null | AppSchema;
	};
};

type DefinitionCatalogRows = {
	readonly savedViews: ReadonlyArray<CatalogSavedView>;
	readonly eventSchemas: ReadonlyArray<CatalogEventSchema>;
	readonly entitySchemas: ReadonlyArray<CatalogEntitySchema>;
	readonly signalSchemas: ReadonlyArray<CatalogSignalSchema>;
	readonly calendarSources: ReadonlyArray<CatalogCalendarSource>;
	readonly relationshipSchemas: ReadonlyArray<CatalogRelationshipSchema>;
};

type RevisionCatalog = {
	readonly sections: RevisionSections;
	readonly providers: ReadonlyArray<ProviderRow>;
	readonly savedViews: ReadonlyArray<SavedViewRow>;
	readonly eventSchemas: ReadonlyArray<EventSchemaRow>;
	readonly entitySchemas: ReadonlyArray<EntitySchemaRow>;
	readonly signalSchemas: ReadonlyArray<SignalSchemaRow>;
	readonly importSources: ReadonlyArray<ImportSourceRow>;
	readonly calendarSources: ReadonlyArray<CalendarSourceRow>;
	readonly providerOperations: ReadonlyArray<ProviderOperationRow>;
	readonly relationshipSchemas: ReadonlyArray<RelationshipSchemaRow>;
	readonly integrationProviders: ReadonlyArray<IntegrationProviderRow>;
};

const kernelOwner: Owner = { pluginId: null, packageId: null, pluginScope: null };

const scopeRank = (scope: null | PluginScope) => {
	if (scope === null) {
		return 0;
	}
	return scope === "system" ? 1 : 2;
};

const compareText = (left: null | string, right: null | string) => {
	if (left === right) {
		return 0;
	}
	if (left === null) {
		return 1;
	}
	if (right === null) {
		return -1;
	}
	return left < right ? -1 : 1;
};

/** Kernel rows first (or last with `pluginsFirst`), then system and user plugins, by package and position. */
export const catalogOrder =
	(pluginsFirst = false) =>
	(left: Owner & { readonly position: number }, right: Owner & { readonly position: number }) => {
		const rank = scopeRank(left.pluginScope) - scopeRank(right.pluginScope);
		return (
			(pluginsFirst ? -rank : rank) ||
			compareText(left.packageId, right.packageId) ||
			left.position - right.position
		);
	};

const emptyRevision: RevisionCatalog = {
	providers: [],
	savedViews: [],
	eventSchemas: [],
	entitySchemas: [],
	importSources: [],
	signalSchemas: [],
	calendarSources: [],
	providerOperations: [],
	relationshipSchemas: [],
	integrationProviders: [],
	sections: { hooks: [], scripts: [], signalSchemas: [], queries: undefined },
};

const groupByRevision = <Row extends { readonly pluginRevisionId: null | string }>(
	rows: ReadonlyArray<Row>,
) => {
	const grouped = new Map<null | string, Array<Row>>();
	for (const row of rows) {
		grouped.set(row.pluginRevisionId, [...(grouped.get(row.pluginRevisionId) ?? []), row]);
	}
	return grouped;
};

const revisionWhere = (column: PgColumn, ids: ReadonlyArray<null | string>) => {
	const revisionIds = ids.filter((id) => id !== null);
	return or(
		ids.includes(null) ? isNull(column) : undefined,
		revisionIds.length > 0 ? inArray(column, revisionIds) : undefined,
	);
};

const resolveUserPlugin = (row: {
	readonly userId: string;
	readonly pluginId: string;
	readonly isHidden: boolean;
	readonly sortOrder: number;
	readonly installationId: string;
	readonly ownerUserId: null | string;
	readonly packageId: PluginPackageId;
	readonly health: InstallationHealth;
	readonly activeRevisionId: null | string;
	readonly environmentConfigIsUsable: boolean;
	readonly installationConfigIsUsable: boolean;
	readonly environmentConfigRevisionId: null | string;
	readonly installationConfigRevisionId: null | string;
	readonly installationConfigPluginRevisionId: null | string;
}): ReadonlyArray<UserPlugin> => {
	if (row.activeRevisionId === null) {
		return [];
	}
	const system = row.ownerUserId === null;
	const configIsUsable = system
		? row.environmentConfigIsUsable
		: row.installationConfigPluginRevisionId === row.activeRevisionId &&
			row.installationConfigIsUsable;
	return [
		{
			userId: row.userId,
			health: row.health,
			pluginId: row.pluginId,
			isHidden: row.isHidden,
			sortOrder: row.sortOrder,
			packageId: row.packageId,
			ownerUserId: row.ownerUserId,
			scope: system ? "system" : "user",
			installationId: row.installationId,
			activeRevisionId: row.activeRevisionId,
			isListed: row.health !== "incompatible",
			isExecutable: !row.isHidden && row.health === "ready" && configIsUsable,
			configRevisionId: system ? row.environmentConfigRevisionId : row.installationConfigRevisionId,
			isDefinitionEffective:
				!row.isHidden && (row.health === "ready" || (system && row.health === "installing")),
		},
	];
};

const environmentConfig = sql.raw("environment_config");
const installationConfig = sql.raw("installation_config");

const userPluginsQuery = (where: SQL) => sql`
	select i.user_id as "userId", i.plugin_id as "pluginId", i.id as "installationId", i.health,
		i.is_hidden as "isHidden", i.sort_order as "sortOrder", p.package_id as "packageId",
		p.owner_user_id as "ownerUserId", p.active_revision_id as "activeRevisionId",
		p.environment_config_revision_id as "environmentConfigRevisionId",
		i.active_config_revision_id as "installationConfigRevisionId",
		${installationConfig}.plugin_revision_id as "installationConfigPluginRevisionId",
		coalesce(${installationConfig}.encrypted_payload is not null and ${installationConfig}.owner_user_id = i.user_id
			and ${installationConfig}.plugin_installation_id = i.id, false) as "installationConfigIsUsable",
		coalesce(${environmentConfig}.plugin_revision_id = p.active_revision_id and ${environmentConfig}.encrypted_payload is not null
			and ${environmentConfig}.owner_user_id is null, false) as "environmentConfigIsUsable"
	from plugin_installation i
	join plugin p on p.id = i.plugin_id
	left join plugin_config_revision ${installationConfig} on ${installationConfig}.id = i.active_config_revision_id
	left join plugin_config_revision ${environmentConfig} on ${environmentConfig}.id = p.environment_config_revision_id
	where i.uninstalled_at is null and p.status = 'active' and (p.owner_user_id is null or p.owner_user_id = i.user_id)
		and ${where}
	order by i.user_id, i.sort_order, p.package_id
`;

type UserPluginRow = Parameters<typeof resolveUserPlugin>[0];

const dataJsonImportSource = (userId: string): CatalogImportSource => ({
	userId,
	plan: null,
	position: 0,
	pluginId: null,
	packageId: null,
	exportHelp: null,
	slug: "data-json",
	pluginScope: null,
	name: "Data import",
	installationId: null,
	pluginRevisionId: null,
	workflowScriptId: null,
	configRevisionId: null,
	workflowScriptSlug: null,
	workflowSlug: "data-json",
	requiredPluginConfigKeys: [],
	id: `kernel:data-json:${userId}`,
	inputSchema: dataJsonImportInputSchema,
	description: "Import generic entities, relationships, and events from JSON.",
});

const dataJsonIntegrationProvider = (userId: string): CatalogIntegrationProvider => ({
	userId,
	plan: null,
	lot: "sink",
	position: 0,
	scriptId: null,
	pluginId: null,
	packageId: null,
	scriptSlug: null,
	slug: "data-json",
	pluginScope: null,
	name: "Data webhook",
	installationId: null,
	requiresProKey: false,
	configRevisionId: null,
	pluginRevisionId: null,
	supportsOwnershipSync: false,
	id: `kernel:data-json:${userId}`,
	settingsSchema: dataJsonIntegrationSettingsSchema,
	description: "Receive generic entities, relationships, and events as JSON.",
});

export const pluginOwner = (plugin: Pick<UserPlugin, "scope" | "pluginId" | "packageId">) => ({
	pluginId: plugin.pluginId,
	pluginScope: plugin.scope,
	packageId: plugin.packageId,
});

const resolveUserCatalog = (
	userId: string,
	plugins: ReadonlyArray<UserPlugin>,
	kernel: RevisionCatalog,
	revisions: ReadonlyMap<string, RevisionCatalog>,
): UserCatalog => {
	const listed = plugins.filter(({ isListed }) => isListed);
	const revisionOf = (plugin: UserPlugin) =>
		revisions.get(plugin.activeRevisionId) ?? emptyRevision;
	const entitySchemas: Array<CatalogEntitySchema> = [
		...kernel.entitySchemas.map((row) => ({ ...row, ...kernelOwner, isEffective: true })),
		...listed.flatMap((plugin) =>
			revisionOf(plugin).entitySchemas.map((row) =>
				Object.assign({}, row, pluginOwner(plugin), { isEffective: plugin.isDefinitionEffective }),
			),
		),
	];
	const entityById = new Map(entitySchemas.map((row) => [row.id, row]));
	const eventSchemas = [kernel, ...listed.map(revisionOf)].flatMap((revision) =>
		revision.eventSchemas.flatMap((row) => {
			const entity = entityById.get(row.entitySchemaId);
			return entity
				? [
						{
							...row,
							pluginId: entity.pluginId,
							packageId: entity.packageId,
							isEffective: entity.isEffective,
							pluginScope: entity.pluginScope,
						},
					]
				: [];
		}),
	);
	const declaresEntity = (revision: RevisionCatalog, slug: null | string) =>
		slug === null || revision.entitySchemas.some((entity) => entity.slug === slug);
	const relationshipSchemas: Array<CatalogRelationshipSchema> = [
		...kernel.relationshipSchemas.map((row) => ({ ...row, ...kernelOwner, isEffective: true })),
		...listed.flatMap((plugin) => {
			const revision = revisionOf(plugin);
			return revision.relationshipSchemas
				.filter(
					(row) =>
						declaresEntity(revision, row.sourceEntitySchemaSlug) &&
						declaresEntity(revision, row.targetEntitySchemaSlug),
				)
				.map((row) =>
					Object.assign({}, row, pluginOwner(plugin), {
						isEffective: plugin.isDefinitionEffective,
					}),
				);
		}),
	];
	const relationshipOf = (plugin: UserPlugin, slug: string) =>
		relationshipSchemas.find((row) => row.pluginId === plugin.pluginId && row.slug === slug);
	const signalSchemas: Array<CatalogSignalSchema> = [
		...kernel.signalSchemas.map((row) => ({ ...row, ...kernelOwner, isEffective: true })),
		...listed.flatMap((plugin) =>
			revisionOf(plugin).signalSchemas.flatMap((row) => {
				const policy = row.audiencePolicy;
				if (policy.kind !== "related_users") {
					return [{ ...row, ...pluginOwner(plugin), isEffective: plugin.isDefinitionEffective }];
				}
				const relationship = relationshipOf(plugin, policy.relationshipSchemaSlug);
				return relationship
					? [
							{
								...row,
								...pluginOwner(plugin),
								isEffective: plugin.isDefinitionEffective && relationship.isEffective,
							},
						]
					: [];
			}),
		),
	];
	const savedViews: Array<CatalogSavedView> = [
		...kernel.savedViews.map((row) => ({ ...row, ...kernelOwner, isEffective: true })),
		...listed.flatMap((plugin) =>
			revisionOf(plugin).savedViews.map((row) =>
				Object.assign({}, row, pluginOwner(plugin), { isEffective: plugin.isDefinitionEffective }),
			),
		),
	];
	const calendarSources = listed.flatMap((plugin) =>
		revisionOf(plugin).calendarSources.map((row) =>
			Object.assign({}, row, pluginOwner(plugin), { isEffective: plugin.isDefinitionEffective }),
		),
	);
	const executable = plugins.filter(({ isExecutable }) => isExecutable);
	const executableOwner = (plugin: UserPlugin) => ({
		userId,
		...pluginOwner(plugin),
		installationId: plugin.installationId,
		configRevisionId: plugin.configRevisionId,
	});
	return {
		userId,
		plugins,
		revisions,
		savedViews,
		eventSchemas,
		entitySchemas,
		signalSchemas,
		calendarSources,
		relationshipSchemas,
		importSources: [
			...executable.flatMap((plugin) =>
				revisionOf(plugin).importSources.map((row) =>
					Object.assign({}, row, executableOwner(plugin)),
				),
			),
			dataJsonImportSource(userId),
		],
		integrationProviders: [
			...executable.flatMap((plugin) =>
				revisionOf(plugin).integrationProviders.map((row) =>
					Object.assign({}, row, executableOwner(plugin)),
				),
			),
			dataJsonIntegrationProvider(userId),
		],
	};
};

const resolveGlobalCatalog = (
	plugins: ReadonlyArray<GlobalPlugin>,
	kernel: RevisionCatalog,
	revisions: ReadonlyMap<string, RevisionCatalog>,
): GlobalCatalog => {
	const owned = plugins.map((plugin) => ({
		revision: revisions.get(plugin.activeRevisionId) ?? emptyRevision,
		owner: {
			pluginId: plugin.pluginId,
			packageId: plugin.packageId,
			pluginScope: "system" as const,
		},
	}));
	const withKernel = <Row>(
		rows: (revision: RevisionCatalog) => ReadonlyArray<Row>,
	): Array<Row & Owner & Effective> => [
		...rows(kernel).map((row) => Object.assign({}, row, kernelOwner, { isEffective: true })),
		...owned.flatMap(({ owner, revision }) =>
			rows(revision).map((row) => Object.assign({}, row, owner, { isEffective: true })),
		),
	];
	return {
		plugins,
		savedViews: withKernel(({ savedViews }) => savedViews),
		eventSchemas: withKernel(({ eventSchemas }) => eventSchemas),
		entitySchemas: withKernel(({ entitySchemas }) => entitySchemas),
		signalSchemas: withKernel(({ signalSchemas }) => signalSchemas),
		relationshipSchemas: withKernel(({ relationshipSchemas }) => relationshipSchemas),
		calendarSources: owned.flatMap(({ owner, revision }) =>
			revision.calendarSources.map((row) => ({ ...row, ...owner, isEffective: true })),
		),
	};
};

const revisionCacheLimit = 256;

/**
 * Resolves the definitions each user sees from their installations and the definitions of the revisions those
 * installations run. Revisions never change, so their definitions are kept by revision ID; the kernel's are kept
 * until `replaceKernel` rewrites them, which only boot and tests do.
 */
export class DefinitionCatalog extends Context.Service<DefinitionCatalog>()(
	"@ryot-app/kernel-backend/modules/definitions/catalog/DefinitionCatalog",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const revisions = new Map<string, RevisionCatalog>();
			let kernel: null | RevisionCatalog = null;

			const loadRevisions = Effect.fn("DefinitionCatalog.loadRevisions")(function* (
				ids: ReadonlyArray<null | string>,
			) {
				const loaded = new Map<null | string, RevisionCatalog>();
				if (ids.length === 0) {
					return loaded;
				}
				const entitySchemas = yield* session.run((db) =>
					db
						.select()
						.from(schema.definitionEntitySchema)
						.where(revisionWhere(schema.definitionEntitySchema.pluginRevisionId, ids))
						.orderBy(asc(schema.definitionEntitySchema.position)),
				);
				const eventSchemas = yield* session.run((db) =>
					db
						.select({
							...getTableColumns(schema.definitionEventSchema),
							entitySchemaSlug: schema.definitionEntitySchema.slug,
							pluginRevisionId: schema.definitionEntitySchema.pluginRevisionId,
						})
						.from(schema.definitionEventSchema)
						.innerJoin(
							schema.definitionEntitySchema,
							eq(schema.definitionEntitySchema.id, schema.definitionEventSchema.entitySchemaId),
						)
						.where(revisionWhere(schema.definitionEntitySchema.pluginRevisionId, ids))
						.orderBy(asc(schema.definitionEventSchema.position)),
				);
				const relationshipSchemas = yield* session.run((db) =>
					db
						.select()
						.from(schema.definitionRelationshipSchema)
						.where(revisionWhere(schema.definitionRelationshipSchema.pluginRevisionId, ids))
						.orderBy(asc(schema.definitionRelationshipSchema.position)),
				);
				const signalSchemas = yield* session.run((db) =>
					db
						.select()
						.from(schema.definitionSignalSchema)
						.where(revisionWhere(schema.definitionSignalSchema.pluginRevisionId, ids))
						.orderBy(asc(schema.definitionSignalSchema.position)),
				);
				const savedViews = yield* session.run((db) =>
					db
						.select()
						.from(schema.definitionSavedView)
						.where(revisionWhere(schema.definitionSavedView.pluginRevisionId, ids))
						.orderBy(asc(schema.definitionSavedView.position)),
				);
				const revisionIds = ids.filter((id) => id !== null);
				const pluginRows = revisionIds.length > 0;
				const calendarSources = pluginRows
					? yield* session.run((db) =>
							db
								.select()
								.from(schema.definitionCalendarSource)
								.where(inArray(schema.definitionCalendarSource.pluginRevisionId, revisionIds))
								.orderBy(asc(schema.definitionCalendarSource.position)),
						)
					: [];
				const importSources = pluginRows
					? yield* session.run((db) =>
							db
								.select({
									...getTableColumns(schema.definitionImportSource),
									workflowScriptId: schema.sandboxScript.id,
								})
								.from(schema.definitionImportSource)
								.leftJoin(
									schema.sandboxScript,
									and(
										eq(
											schema.sandboxScript.pluginRevisionId,
											schema.definitionImportSource.pluginRevisionId,
										),
										eq(schema.sandboxScript.slug, schema.definitionImportSource.workflowScriptSlug),
									),
								)
								.where(inArray(schema.definitionImportSource.pluginRevisionId, revisionIds))
								.orderBy(asc(schema.definitionImportSource.position)),
						)
					: [];
				const integrationProviders = pluginRows
					? yield* session.run((db) =>
							db
								.select({
									...getTableColumns(schema.definitionIntegrationProvider),
									scriptId: schema.sandboxScript.id,
								})
								.from(schema.definitionIntegrationProvider)
								.leftJoin(
									schema.sandboxScript,
									and(
										eq(
											schema.sandboxScript.pluginRevisionId,
											schema.definitionIntegrationProvider.pluginRevisionId,
										),
										eq(schema.sandboxScript.slug, schema.definitionIntegrationProvider.scriptSlug),
									),
								)
								.where(inArray(schema.definitionIntegrationProvider.pluginRevisionId, revisionIds))
								.orderBy(asc(schema.definitionIntegrationProvider.position)),
						)
					: [];
				const providers = pluginRows
					? yield* session.run((db) =>
							db
								.select()
								.from(schema.definitionProvider)
								.where(inArray(schema.definitionProvider.pluginRevisionId, revisionIds))
								.orderBy(asc(schema.definitionProvider.position)),
						)
					: [];
				const providerOperations = pluginRows
					? yield* session.run((db) =>
							db
								.select({
									...getTableColumns(schema.definitionProviderOperation),
									scriptId: schema.sandboxScript.id,
									scriptProviderId: schema.sandboxScript.providerId,
									scriptKind: sql<null | string>`${schema.sandboxScript.metadata} ->> 'kind'`,
									scriptSearchOptionsSchema: sql<null | AppSchema>`${schema.sandboxScript.metadata} -> 'searchOptionsSchema'`,
									scriptProviderOperation: sql<
										null | string
									>`${schema.sandboxScript.metadata} ->> 'providerOperation'`,
								})
								.from(schema.definitionProviderOperation)
								.leftJoin(
									schema.sandboxScript,
									and(
										eq(
											schema.sandboxScript.pluginRevisionId,
											schema.definitionProviderOperation.pluginRevisionId,
										),
										eq(schema.sandboxScript.slug, schema.definitionProviderOperation.scriptSlug),
									),
								)
								.where(inArray(schema.definitionProviderOperation.pluginRevisionId, revisionIds)),
						)
					: [];
				const sections = pluginRows
					? yield* session.run((db) =>
							db
								.select({
									id: schema.pluginRevision.id,
									hooks: schema.pluginRevision.hooks,
									queries: schema.pluginRevision.queries,
									scripts: schema.pluginRevision.scripts,
									signalSchemas: schema.pluginRevision.signalSchemas,
								})
								.from(schema.pluginRevision)
								.where(inArray(schema.pluginRevision.id, revisionIds)),
						)
					: [];
				const entities = groupByRevision(entitySchemas);
				const events = groupByRevision(eventSchemas);
				const relationships = groupByRevision(relationshipSchemas);
				const signals = groupByRevision(signalSchemas);
				const views = groupByRevision(savedViews);
				const calendars = groupByRevision(calendarSources);
				const imports = groupByRevision(importSources);
				const integrations = groupByRevision(integrationProviders);
				const declaredProviders = groupByRevision(providers);
				const operations = groupByRevision(
					providerOperations.map(
						({
							scriptId,
							scriptKind,
							scriptProviderId,
							scriptProviderOperation,
							scriptSearchOptionsSchema,
							...row
						}) =>
							Object.assign(row, {
								script:
									scriptId === null
										? null
										: {
												id: scriptId,
												kind: scriptKind,
												providerId: scriptProviderId,
												providerOperation: scriptProviderOperation,
												searchOptionsSchema: scriptSearchOptionsSchema,
											},
							}),
					),
				);
				for (const id of ids) {
					const declared = sections.find((section) => section.id === id);
					loaded.set(id, {
						savedViews: views.get(id) ?? [],
						eventSchemas: events.get(id) ?? [],
						signalSchemas: signals.get(id) ?? [],
						importSources: imports.get(id) ?? [],
						entitySchemas: entities.get(id) ?? [],
						calendarSources: calendars.get(id) ?? [],
						providers: declaredProviders.get(id) ?? [],
						sections: declared ?? emptyRevision.sections,
						providerOperations: operations.get(id) ?? [],
						relationshipSchemas: relationships.get(id) ?? [],
						integrationProviders: integrations.get(id) ?? [],
					});
				}
				return loaded;
			});

			const catalogs = Effect.fn("DefinitionCatalog.revisions")(function* (
				ids: ReadonlyArray<string>,
			) {
				const missing = [...new Set(ids)].filter((id) => !revisions.has(id));
				const wanted: Array<null | string> = kernel === null ? [null, ...missing] : missing;
				const loaded = yield* loadRevisions(wanted);
				for (const [id, revision] of loaded) {
					if (id === null) {
						kernel = revision;
						continue;
					}
					const oldest = revisions.keys().next();
					if (revisions.size >= revisionCacheLimit && !oldest.done) {
						revisions.delete(oldest.value);
					}
					revisions.set(id, revision);
				}
				const result = new Map<string, RevisionCatalog>();
				for (const id of ids) {
					result.set(id, revisions.get(id) ?? loaded.get(id) ?? emptyRevision);
				}
				return { revisions: result, kernel: kernel ?? emptyRevision };
			});

			const listUserPlugins = Effect.fn("DefinitionCatalog.listUserPlugins")(function* (
				where: SQL,
			) {
				const rows = yield* session.run((db) =>
					db.execute<UserPluginRow>(userPluginsQuery(where), "objects"),
				);
				return rows.flatMap(resolveUserPlugin);
			});

			const userPlugins = (userId: string) => listUserPlugins(sql`i.user_id = ${userId}`);

			const forUser = Effect.fn("DefinitionCatalog.forUser")(function* (userId: string) {
				const plugins = yield* userPlugins(userId);
				const resolved = yield* catalogs(plugins.map(({ activeRevisionId }) => activeRevisionId));
				return resolveUserCatalog(userId, plugins, resolved.kernel, resolved.revisions);
			});

			const allUsers = Effect.fn("DefinitionCatalog.allUsers")(function* () {
				const plugins = yield* listUserPlugins(sql`true`);
				const resolved = yield* catalogs(plugins.map(({ activeRevisionId }) => activeRevisionId));
				const byUser = new Map<string, Array<UserPlugin>>();
				for (const plugin of plugins) {
					byUser.set(plugin.userId, [...(byUser.get(plugin.userId) ?? []), plugin]);
				}
				return {
					kernel: resolveUserCatalog("", [], resolved.kernel, resolved.revisions),
					users: [...byUser].map(([userId, owned]) =>
						resolveUserCatalog(userId, owned, emptyRevision, resolved.revisions),
					),
				} satisfies AllUsersCatalog;
			});

			const globalPlugins = Effect.fn("DefinitionCatalog.globalPlugins")(function* () {
				const rows = yield* session.run((db) =>
					db
						.select({
							pluginId: schema.plugin.id,
							packageId: schema.plugin.packageId,
							activeRevisionId: schema.plugin.activeRevisionId,
							configRevisionId: schema.plugin.environmentConfigRevisionId,
							isExecutable: sql<boolean>`coalesce(${schema.pluginConfigRevision.ownerUserId} is null and ${schema.pluginConfigRevision.encryptedPayload} is not null, false)`,
						})
						.from(schema.plugin)
						.leftJoin(
							schema.pluginConfigRevision,
							eq(schema.pluginConfigRevision.id, schema.plugin.environmentConfigRevisionId),
						)
						.where(and(isNull(schema.plugin.ownerId), eq(schema.plugin.status, "active")))
						.orderBy(asc(schema.plugin.packageId)),
				);
				return rows.flatMap(({ activeRevisionId, ...row }) =>
					activeRevisionId === null ? [] : [{ ...row, activeRevisionId }],
				);
			});

			const global = Effect.fn("DefinitionCatalog.global")(function* () {
				const plugins = yield* globalPlugins();
				const resolved = yield* catalogs(plugins.map(({ activeRevisionId }) => activeRevisionId));
				return resolveGlobalCatalog(plugins, resolved.kernel, resolved.revisions);
			});

			const revision = Effect.fn("DefinitionCatalog.revision")(function* (revisionId: string) {
				return (yield* catalogs([revisionId])).revisions.get(revisionId) ?? emptyRevision;
			});

			const sandboxProviders = Effect.fn("DefinitionCatalog.sandboxProviders")(function* (
				catalog: UserCatalog,
			) {
				const executable = catalog.plugins.filter(({ isExecutable }) => isExecutable);
				const rows =
					executable.length > 0
						? yield* session.run((db) =>
								db
									.select()
									.from(schema.sandboxProvider)
									.where(
										inArray(
											schema.sandboxProvider.pluginId,
											executable.map(({ pluginId }) => pluginId),
										),
									),
							)
						: [];
				const providers: Array<CatalogSandboxProvider> = [];
				const operations: Array<CatalogSandboxProviderOperation> = [];
				for (const row of rows) {
					const plugin = executable.find(({ pluginId }) => pluginId === row.pluginId);
					const declaring = plugin && catalog.revisions.get(plugin.activeRevisionId);
					if (
						!plugin ||
						!declaring ||
						!declaring.providers.some(
							(declared) =>
								declared.slug === row.slug &&
								declared.rootEntitySchemaSlug === row.rootEntitySchemaSlug,
						) ||
						!declaring.entitySchemas.some(({ slug }) => slug === row.rootEntitySchemaSlug)
					) {
						continue;
					}
					providers.push({
						...row,
						userId: catalog.userId,
						pluginScope: plugin.scope,
						packageId: plugin.packageId,
						installationId: plugin.installationId,
					});
					for (const declared of declaring.providerOperations) {
						const script = declared.script;
						if (
							declared.providerSlug === row.slug &&
							script?.providerId === row.id &&
							script.kind === "provider" &&
							script.providerOperation === declared.operation
						) {
							operations.push({
								providerId: row.id,
								userId: catalog.userId,
								pluginId: row.pluginId,
								packageId: plugin.packageId,
								operation: declared.operation,
								optionsSchema: declared.operation === "search" ? script.searchOptionsSchema : null,
							});
						}
					}
				}
				return { providers, operations };
			});

			const declaredQuery = Effect.fn("DefinitionCatalog.declaredQuery")(function* (
				userId: string,
				reference: PluginPackageReference,
				query: string,
				context?: { readonly pluginId: string; readonly pluginRevisionId: string },
			) {
				const installed = (yield* forUser(userId)).plugins.find(isReadyPackage(reference));
				if (!installed) {
					return null;
				}
				const revisionId =
					context?.pluginId === installed.pluginId
						? context.pluginRevisionId
						: installed.activeRevisionId;
				const declaration = (yield* revision(revisionId)).sections.queries?.[query];
				if (!declaration) {
					return null;
				}
				const document = mapPluginIdentityReferences(declaration.document, (owner) =>
					owner.kind === "self"
						? { kind: "local", pluginId: PluginId.make(installed.pluginId) }
						: owner,
				);
				return Result.isFailure(document) ? null : { revisionId, document: document.success };
			});

			return {
				global,
				forUser,
				allUsers,
				revision,
				userPlugins,
				declaredQuery,
				globalPlugins,
				listUserPlugins,
				sandboxProviders,
				replaceKernel: Effect.sync(() => {
					kernel = null;
				}),
				kernel: Effect.map(catalogs([]), (resolved) => resolved.kernel),
				revisions: (ids: ReadonlyArray<string>) =>
					Effect.map(catalogs(ids), ({ revisions: resolved }) => resolved),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
