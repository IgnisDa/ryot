import type { DbError } from "@ryot-app/contract/errors";
import {
	type DeclarationReference,
	definitionKey,
	definitionOwnerPluginId,
	type EntitySchemaReference,
	type EventSchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { and, eq, isNull, notInArray, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import * as schema from "#schema/tables/combined";

import {
	type CatalogCalendarSource,
	type CatalogEntitySchema,
	type CatalogEventSchema,
	catalogOrder,
	type CatalogRelationshipSchema,
	type CatalogSavedView,
	type CatalogSignalSchema,
	DefinitionCatalog,
} from "./catalog";
import { type DefinitionReadContext, DefinitionReadUnavailable } from "./read-context";
import {
	type CalendarSourceDefinition,
	type DefinitionKind,
	definitionRecord,
	type DefinitionSnapshot,
	type DefinitionSource,
	type EntityRelationshipDefinitions,
	type EntitySchemaSnapshot,
	type EventSchemaDefinition,
	type RelationshipSchemaDefinition,
	type SavedViewDefinition,
	type SignalSchemaDefinition,
} from "./snapshot";
import type { RevisionDefinitions } from "./source";

type Placement = "isEffective" | "pluginScope";
type ListedOption = { readonly listed: boolean };
type SavedViewRow = Omit<CatalogSavedView, Placement>;
type EventSchemaRow = Omit<CatalogEventSchema, Placement>;
type EntitySchemaRow = Omit<CatalogEntitySchema, Placement>;
type SignalSchemaRow = Omit<CatalogSignalSchema, Placement>;
type RelationshipSchemaRow = Omit<CatalogRelationshipSchema, Placement>;

type EventSchemaFields = Pick<
	EventSchemaRow,
	"name" | "slug" | "eventGroup" | "projection" | "entitySchemaId" | "propertiesSchema"
>;

type RevisionDeclarationQuery<K extends keyof RevisionDeclarations> = {
	readonly kind: K;
	readonly slug: string;
	readonly revisionId: string;
	readonly entitySchemaSlug?: string;
};

type CalendarSourceRow = Pick<
	CatalogCalendarSource,
	| "art"
	| "done"
	| "icon"
	| "name"
	| "slug"
	| "query"
	| "caption"
	| "startAt"
	| "subject"
	| "pluginId"
	| "precision"
>;

type RevisionDeclarations = {
	readonly entity: Pick<EntitySchemaRow, "propertiesSchema">;
	readonly relationship: Omit<RelationshipSchemaDefinition, "pluginId">;
	readonly event: Pick<EventSchemaDefinition, "eventGroup" | "projection" | "propertiesSchema">;
};

type DefinitionRows = {
	readonly savedViews: ReadonlyArray<SavedViewRow>;
	readonly entitySchemas: ReadonlyArray<EntitySchemaRow>;
	readonly signalSchemas: ReadonlyArray<SignalSchemaRow>;
	readonly eventSchemas: ReadonlyArray<EventSchemaFields>;
	readonly calendarSources: ReadonlyArray<CalendarSourceRow>;
	readonly relationshipSchemas: ReadonlyArray<RelationshipSchemaRow>;
};

const toEventSchema = (
	row: Pick<
		EventSchemaRow,
		"name" | "slug" | "pluginId" | "eventGroup" | "projection" | "propertiesSchema"
	>,
): EventSchemaDefinition => ({
	name: row.name,
	slug: row.slug,
	pluginId: row.pluginId,
	propertiesSchema: row.propertiesSchema,
	...(row.projection === null ? {} : { projection: row.projection }),
	...(row.eventGroup === null ? {} : { eventGroup: row.eventGroup }),
});

const toEntitySchema = (
	row: EntitySchemaRow,
	eventSchemas: ReadonlyArray<EventSchemaFields>,
): EntitySchemaSnapshot => ({
	icon: row.icon,
	name: row.name,
	slug: row.slug,
	pluginId: row.pluginId,
	propertiesSchema: row.propertiesSchema,
	mergeIdentityProperties: row.mergeIdentityProperties,
	...(row.editor ? { editor: row.editor } : {}),
	...(row.browse ? { browse: row.browse } : {}),
	...(row.userState ? { userState: row.userState } : {}),
	...(row.fold ? { fold: row.fold } : {}),
	eventSchemas: Object.fromEntries(
		eventSchemas.map((event) => [event.slug, toEventSchema({ ...event, pluginId: row.pluginId })]),
	),
});

const toRelationshipSchema = (row: RelationshipSchemaRow): RelationshipSchemaDefinition => ({
	name: row.name,
	slug: row.slug,
	pluginId: row.pluginId,
	propertiesSchema: row.propertiesSchema,
	sourceEntitySchemaSlug: row.sourceEntitySchemaSlug,
	targetEntitySchemaSlug: row.targetEntitySchemaSlug,
	...(row.projection === null ? {} : { projection: row.projection }),
	...(row.userWritePolicy === null ? {} : { userWritePolicy: row.userWritePolicy }),
});

const toSignalSchema = (row: SignalSchemaRow): SignalSchemaDefinition => ({
	name: row.name,
	slug: row.slug,
	pluginId: row.pluginId,
	catalogState: row.catalogState,
	audiencePolicy: row.audiencePolicy,
	propertiesSchema: row.propertiesSchema,
	notificationHookSlug: row.notificationHookSlug,
});

const toSavedView = (row: SavedViewRow): SavedViewDefinition => ({
	icon: row.icon,
	name: row.name,
	slug: row.slug,
	pluginId: row.pluginId,
	renderer: row.renderer,
	settings: row.settings,
	sortOrder: row.sortOrder,
	dataSources: row.dataSources,
});

const toCalendarSource = (row: CalendarSourceRow): CalendarSourceDefinition => ({
	art: row.art,
	done: row.done,
	icon: row.icon,
	name: row.name,
	slug: row.slug,
	query: row.query,
	caption: row.caption,
	startAt: row.startAt,
	subject: row.subject,
	pluginId: row.pluginId,
	precision: row.precision,
});

const recordByIdentity = <
	Definition extends { readonly slug: string; readonly pluginId: null | string },
>(
	kind: DefinitionKind,
	definitions: ReadonlyArray<Definition>,
) => Effect.sync(() => definitionRecord(kind, definitions));

const eventsByEntitySchema = (rows: ReadonlyArray<EventSchemaFields>) => {
	const grouped = new Map<string, Array<EventSchemaFields>>();
	for (const row of rows) {
		grouped.set(row.entitySchemaId, [...(grouped.get(row.entitySchemaId) ?? []), row]);
	}
	return grouped;
};

const toSnapshot = Effect.fn(function* (rows: DefinitionRows) {
	const events = eventsByEntitySchema(rows.eventSchemas);
	return {
		savedViews: yield* recordByIdentity("saved-view", rows.savedViews.map(toSavedView)),
		signalSchemas: yield* recordByIdentity("signal", rows.signalSchemas.map(toSignalSchema)),
		calendarSources: yield* recordByIdentity(
			"calendar-source",
			rows.calendarSources.map(toCalendarSource),
		),
		relationshipSchemas: yield* recordByIdentity(
			"relationship",
			rows.relationshipSchemas.map(toRelationshipSchema),
		),
		entitySchemas: yield* recordByIdentity(
			"entity",
			rows.entitySchemas.map((row) => toEntitySchema(row, events.get(row.id) ?? [])),
		),
	} satisfies DefinitionSnapshot;
});

const toEntityRelationshipDefinitions = Effect.fn(function* (rows: {
	readonly relationshipSchemas: ReadonlyArray<RelationshipSchemaRow>;
	readonly entitySchemas: ReadonlyArray<Pick<EntitySchemaRow, "slug" | "pluginId">>;
}) {
	const definitions: EntityRelationshipDefinitions = {
		relationshipSchemas: yield* recordByIdentity(
			"relationship",
			rows.relationshipSchemas.map(toRelationshipSchema),
		),
		entitySchemas: yield* recordByIdentity(
			"entity",
			rows.entitySchemas.map(({ slug, pluginId }) => ({ slug, pluginId })),
		),
	};
	return definitions;
});

const toSource = (snapshot: DefinitionSnapshot): DefinitionSource => ({
	savedViews: Object.values(snapshot.savedViews),
	signalSchemas: Object.values(snapshot.signalSchemas),
	calendarSources: Object.values(snapshot.calendarSources),
	relationshipSchemas: Object.values(snapshot.relationshipSchemas),
	entitySchemas: Object.values(snapshot.entitySchemas).map(({ eventSchemas, ...entitySchema }) =>
		Object.assign({}, entitySchema, { eventSchemas: Object.values(eventSchemas) }),
	),
});

const placed = <Row extends { readonly isEffective: boolean }>(
	rows: ReadonlyArray<Row>,
	options: ListedOption,
	...filters: ReadonlyArray<(row: Row) => boolean>
) =>
	rows.filter(
		(row) => (options.listed || row.isEffective) && filters.every((filter) => filter(row)),
	);

const ordered = <Row extends Parameters<ReturnType<typeof catalogOrder>>[0]>(
	rows: ReadonlyArray<Row>,
	pluginsFirst = false,
) => [...rows].sort(catalogOrder(pluginsFirst));

const byPosition = <Row extends { readonly position: number }>(rows: ReadonlyArray<Row>) =>
	[...rows].sort((left, right) => left.position - right.position);

const matches =
	(references: ReadonlyArray<DeclarationReference>) =>
	(row: { readonly slug: string; readonly pluginId: null | string }) =>
		references.some(
			(reference) =>
				row.slug === reference.slug && row.pluginId === definitionOwnerPluginId(reference.owner),
		);

const effective = { listed: false } as const;

export class DefinitionRepository extends Context.Service<DefinitionRepository>()(
	"@ryot-app/kernel-backend/modules/definitions/repository/DefinitionRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const catalog = yield* DefinitionCatalog;
			const pruneKernelRows = Effect.fn(function* (
				table:
					| typeof schema.definitionSavedView
					| typeof schema.definitionEntitySchema
					| typeof schema.definitionSignalSchema
					| typeof schema.definitionRelationshipSchema,
				slugs: ReadonlyArray<string>,
			) {
				yield* session.run((db) =>
					db
						.delete(table)
						.where(
							and(
								isNull(table.pluginRevisionId),
								slugs.length > 0 ? notInArray(table.slug, [...slugs]) : undefined,
							),
						),
				);
			});
			const writeRevisionDefinitions = Effect.fn("DefinitionRepository.writeRevisionDefinitions")(
				function* (input: {
					readonly pluginRevisionId: string;
					readonly definitions: RevisionDefinitions;
				}) {
					const { definitions, pluginRevisionId } = input;
					if (definitions.entitySchemas.length > 0) {
						const entities = yield* session.run((db) =>
							db
								.insert(schema.definitionEntitySchema)
								.values(
									definitions.entitySchemas.map((definition, position) => ({
										position,
										pluginRevisionId,
										icon: definition.icon,
										name: definition.name,
										slug: definition.slug,
										fold: definition.fold ?? null,
										editor: definition.editor ?? null,
										browse: definition.browse ?? null,
										userState: definition.userState ?? null,
										propertiesSchema: definition.propertiesSchema,
										occursAtProperty: definition.occursAtProperty ?? null,
										mergeIdentityProperties: [...definition.mergeIdentityProperties],
									})),
								)
								.returning({
									id: schema.definitionEntitySchema.id,
									slug: schema.definitionEntitySchema.slug,
								}),
						);
						const events = definitions.entitySchemas.flatMap((definition) => {
							const entitySchemaId = entities.find(({ slug }) => slug === definition.slug)?.id;
							return entitySchemaId
								? definition.eventSchemas.map((event, position) => ({
										position,
										entitySchemaId,
										name: event.name,
										slug: event.slug,
										projection: event.projection ?? null,
										eventGroup: event.eventGroup ?? null,
										propertiesSchema: event.propertiesSchema,
									}))
								: [];
						});
						if (events.length > 0) {
							yield* session.run((db) => db.insert(schema.definitionEventSchema).values(events));
						}
					}
					if (definitions.relationshipSchemas.length > 0) {
						yield* session.run((db) =>
							db
								.insert(schema.definitionRelationshipSchema)
								.values(
									definitions.relationshipSchemas.map((definition, position) => ({
										position,
										pluginRevisionId,
										name: definition.name,
										slug: definition.slug,
										retention: definition.retention ?? null,
										projection: definition.projection ?? null,
										propertiesSchema: definition.propertiesSchema,
										userWritePolicy: definition.userWritePolicy ?? null,
										sourceEntitySchemaSlug: definition.sourceEntitySchemaSlug,
										targetEntitySchemaSlug: definition.targetEntitySchemaSlug,
									})),
								),
						);
					}
					if (definitions.signalSchemas.length > 0) {
						yield* session.run((db) =>
							db
								.insert(schema.definitionSignalSchema)
								.values(
									definitions.signalSchemas.map((definition, position) => ({
										position,
										pluginRevisionId,
										name: definition.name,
										slug: definition.slug,
										catalogState: definition.catalogState,
										audiencePolicy: definition.audiencePolicy,
										propertiesSchema: definition.propertiesSchema,
										notificationHookSlug: definition.notificationHookSlug,
									})),
								),
						);
					}
					if (definitions.savedViews.length > 0) {
						yield* session.run((db) =>
							db
								.insert(schema.definitionSavedView)
								.values(
									definitions.savedViews.map((definition, position) => ({
										position,
										pluginRevisionId,
										icon: definition.icon,
										name: definition.name,
										slug: definition.slug,
										renderer: definition.renderer,
										settings: definition.settings,
										sortOrder: definition.sortOrder,
										dataSources: definition.dataSources,
									})),
								),
						);
					}
					if (definitions.calendarSources.length > 0) {
						yield* session.run((db) =>
							db
								.insert(schema.definitionCalendarSource)
								.values(
									definitions.calendarSources.map((definition, position) => ({
										position,
										pluginRevisionId,
										art: definition.art,
										done: definition.done,
										icon: definition.icon,
										name: definition.name,
										slug: definition.slug,
										query: definition.query,
										caption: definition.caption,
										startAt: definition.startAt,
										subject: definition.subject,
										precision: definition.precision,
									})),
								),
						);
					}
					if (definitions.signalSchedules.length > 0) {
						yield* session.run((db) =>
							db
								.insert(schema.definitionSignalSchedule)
								.values(
									definitions.signalSchedules.map((definition, position) => ({
										...definition,
										position,
										pluginRevisionId,
									})),
								),
						);
					}
					if (definitions.importSources.length > 0) {
						yield* session.run((db) =>
							db
								.insert(schema.definitionImportSource)
								.values(
									definitions.importSources.map((definition, position) => ({
										position,
										pluginRevisionId,
										name: definition.name,
										slug: definition.slug,
										plan: definition.plan ?? null,
										description: definition.description,
										inputSchema: definition.inputSchema,
										workflowSlug: definition.workflowSlug,
										exportHelp: definition.exportHelp ?? null,
										workflowScriptSlug: definition.workflowScriptSlug,
										requiredPluginConfigKeys: [...definition.requiredPluginConfigKeys],
									})),
								),
						);
					}
					if (definitions.integrationProviders.length > 0) {
						yield* session.run((db) =>
							db
								.insert(schema.definitionIntegrationProvider)
								.values(
									definitions.integrationProviders.map((definition, position) => ({
										position,
										pluginRevisionId,
										lot: definition.lot,
										name: definition.name,
										slug: definition.slug,
										description: definition.description,
										settingsSchema: definition.settingsSchema,
										requiresProKey: definition.requiresProKey ?? false,
										supportsOwnershipSync: definition.supportsOwnershipSync ?? false,
										plan: definition.lot === "push" ? null : (definition.plan ?? null),
										scriptSlug: definition.lot === "push" ? null : definition.scriptSlug,
									})),
								),
						);
					}
					if (definitions.providers.length > 0) {
						yield* session.run((db) =>
							db
								.insert(schema.definitionProvider)
								.values(
									definitions.providers.map((definition, position) => ({
										position,
										pluginRevisionId,
										slug: definition.slug,
										rootEntitySchemaSlug: definition.rootEntitySchemaSlug,
									})),
								),
						);
					}
					if (definitions.providerOperations.length > 0) {
						yield* session.run((db) =>
							db
								.insert(schema.definitionProviderOperation)
								.values(
									definitions.providerOperations.map((definition) => ({
										pluginRevisionId,
										operation: definition.operation,
										scriptSlug: definition.scriptSlug,
										providerSlug: definition.providerSlug,
									})),
								),
						);
					}
				},
			);

			const replaceKernelDefinitions = Effect.fn("DefinitionRepository.replaceKernelDefinitions")(
				function* (source: DefinitionSource) {
					if (
						source.calendarSources.length > 0 ||
						[
							...source.entitySchemas,
							...source.entitySchemas.flatMap(({ eventSchemas }) => eventSchemas),
							...source.relationshipSchemas,
							...source.signalSchemas,
							...source.savedViews,
						].some(({ pluginId }) => pluginId !== null)
					) {
						return yield* Effect.die(
							new Error("Kernel definition sources require explicit kernel ownership"),
						);
					}
					const entities =
						source.entitySchemas.length > 0
							? yield* session.run((db) =>
									db
										.insert(schema.definitionEntitySchema)
										.values(
											source.entitySchemas.map((definition, position) => ({
												position,
												icon: definition.icon,
												name: definition.name,
												slug: definition.slug,
												pluginRevisionId: null,
												fold: definition.fold ?? null,
												editor: definition.editor ?? null,
												browse: definition.browse ?? null,
												userState: definition.userState ?? null,
												propertiesSchema: definition.propertiesSchema,
												occursAtProperty: definition.occursAtProperty ?? null,
												refreshIntervalDays: definition.refreshIntervalDays ?? null,
												mergeIdentityProperties: [...(definition.mergeIdentityProperties ?? [])],
											})),
										)
										.onConflictDoUpdate({
											target: [
												schema.definitionEntitySchema.pluginRevisionId,
												schema.definitionEntitySchema.slug,
											],
											set: {
												icon: sql`excluded.icon`,
												name: sql`excluded.name`,
												fold: sql`excluded.fold`,
												editor: sql`excluded.editor`,
												browse: sql`excluded.browse`,
												position: sql`excluded.position`,
												userState: sql`excluded.user_state`,
												propertiesSchema: sql`excluded.properties_schema`,
												occursAtProperty: sql`excluded.occurs_at_property`,
												refreshIntervalDays: sql`excluded.refresh_interval_days`,
												mergeIdentityProperties: sql`excluded.merge_identity_properties`,
											},
										})
										.returning({
											id: schema.definitionEntitySchema.id,
											slug: schema.definitionEntitySchema.slug,
										}),
								)
							: [];
					yield* pruneKernelRows(
						schema.definitionEntitySchema,
						source.entitySchemas.map(({ slug }) => slug),
					);
					for (const definition of source.entitySchemas) {
						const entitySchemaId = entities.find(({ slug }) => slug === definition.slug)?.id;
						if (!entitySchemaId) {
							continue;
						}
						if (definition.eventSchemas.length > 0) {
							yield* session.run((db) =>
								db
									.insert(schema.definitionEventSchema)
									.values(
										definition.eventSchemas.map((event, position) => ({
											position,
											entitySchemaId,
											name: event.name,
											slug: event.slug,
											projection: event.projection ?? null,
											eventGroup: event.eventGroup ?? null,
											propertiesSchema: event.propertiesSchema,
										})),
									)
									.onConflictDoUpdate({
										target: [
											schema.definitionEventSchema.entitySchemaId,
											schema.definitionEventSchema.slug,
										],
										set: {
											name: sql`excluded.name`,
											position: sql`excluded.position`,
											projection: sql`excluded.projection`,
											eventGroup: sql`excluded.event_group`,
											propertiesSchema: sql`excluded.properties_schema`,
										},
									}),
							);
						}
						yield* session.run((db) =>
							db.delete(schema.definitionEventSchema).where(
								and(
									eq(schema.definitionEventSchema.entitySchemaId, entitySchemaId),
									definition.eventSchemas.length > 0
										? notInArray(
												schema.definitionEventSchema.slug,
												definition.eventSchemas.map(({ slug }) => slug),
											)
										: undefined,
								),
							),
						);
					}
					if (source.relationshipSchemas.length > 0) {
						yield* session.run((db) =>
							db
								.insert(schema.definitionRelationshipSchema)
								.values(
									source.relationshipSchemas.map((definition, position) => ({
										position,
										name: definition.name,
										slug: definition.slug,
										pluginRevisionId: null,
										retention: definition.retention ?? null,
										projection: definition.projection ?? null,
										propertiesSchema: definition.propertiesSchema,
										userWritePolicy: definition.userWritePolicy ?? null,
										sourceEntitySchemaSlug: definition.sourceEntitySchemaSlug,
										targetEntitySchemaSlug: definition.targetEntitySchemaSlug,
									})),
								)
								.onConflictDoUpdate({
									target: [
										schema.definitionRelationshipSchema.pluginRevisionId,
										schema.definitionRelationshipSchema.slug,
									],
									set: {
										name: sql`excluded.name`,
										position: sql`excluded.position`,
										retention: sql`excluded.retention`,
										projection: sql`excluded.projection`,
										userWritePolicy: sql`excluded.user_write_policy`,
										propertiesSchema: sql`excluded.properties_schema`,
										sourceEntitySchemaSlug: sql`excluded.source_entity_schema_slug`,
										targetEntitySchemaSlug: sql`excluded.target_entity_schema_slug`,
									},
								}),
						);
					}
					yield* pruneKernelRows(
						schema.definitionRelationshipSchema,
						source.relationshipSchemas.map(({ slug }) => slug),
					);
					if (source.signalSchemas.length > 0) {
						yield* session.run((db) =>
							db
								.insert(schema.definitionSignalSchema)
								.values(
									source.signalSchemas.map((definition, position) => ({
										position,
										name: definition.name,
										slug: definition.slug,
										pluginRevisionId: null,
										catalogState: definition.catalogState,
										audiencePolicy: definition.audiencePolicy,
										propertiesSchema: definition.propertiesSchema,
										notificationHookSlug: definition.notificationHookSlug,
									})),
								)
								.onConflictDoUpdate({
									target: [
										schema.definitionSignalSchema.pluginRevisionId,
										schema.definitionSignalSchema.slug,
									],
									set: {
										name: sql`excluded.name`,
										position: sql`excluded.position`,
										catalogState: sql`excluded.catalog_state`,
										audiencePolicy: sql`excluded.audience_policy`,
										propertiesSchema: sql`excluded.properties_schema`,
										notificationHookSlug: sql`excluded.notification_hook_slug`,
									},
								}),
						);
					}
					yield* pruneKernelRows(
						schema.definitionSignalSchema,
						source.signalSchemas.map(({ slug }) => slug),
					);
					if (source.savedViews.length > 0) {
						yield* session.run((db) =>
							db
								.insert(schema.definitionSavedView)
								.values(
									source.savedViews.map((definition, position) => ({
										position,
										icon: definition.icon,
										name: definition.name,
										slug: definition.slug,
										pluginRevisionId: null,
										renderer: definition.renderer,
										settings: definition.settings,
										sortOrder: definition.sortOrder,
										dataSources: definition.dataSources,
									})),
								)
								.onConflictDoUpdate({
									target: [
										schema.definitionSavedView.pluginRevisionId,
										schema.definitionSavedView.slug,
									],
									set: {
										icon: sql`excluded.icon`,
										name: sql`excluded.name`,
										position: sql`excluded.position`,
										renderer: sql`excluded.renderer`,
										settings: sql`excluded.settings`,
										sortOrder: sql`excluded.sort_order`,
										dataSources: sql`excluded.data_sources`,
									},
								}),
						);
					}
					yield* pruneKernelRows(
						schema.definitionSavedView,
						source.savedViews.map(({ slug }) => slug),
					);
					return yield* catalog.replaceKernel;
				},
			);

			const readUserRows = Effect.fn("DefinitionRepository.readUserRows")(function* (
				userId: UserId,
				options: ListedOption,
			) {
				const rows = yield* catalog.forUser(userId);
				return {
					savedViews: ordered(placed(rows.savedViews, options)),
					entitySchemas: ordered(placed(rows.entitySchemas, options)),
					signalSchemas: ordered(placed(rows.signalSchemas, options)),
					eventSchemas: byPosition(placed(rows.eventSchemas, options)),
					calendarSources: ordered(placed(rows.calendarSources, options)),
					relationshipSchemas: ordered(placed(rows.relationshipSchemas, options), true),
				};
			});

			const readGlobalRows = Effect.fn("DefinitionRepository.readGlobalRows")(function* () {
				const rows = yield* catalog.global();
				return {
					savedViews: ordered(rows.savedViews),
					entitySchemas: ordered(rows.entitySchemas),
					signalSchemas: ordered(rows.signalSchemas),
					eventSchemas: byPosition(rows.eventSchemas),
					calendarSources: ordered(rows.calendarSources),
					relationshipSchemas: ordered(rows.relationshipSchemas, true),
				};
			});

			const readKernelRows = Effect.fn("DefinitionRepository.readKernelRows")(function* () {
				const kernel = yield* catalog.kernel;
				const owner = { pluginId: null, packageId: null };
				return toSource(
					yield* toSnapshot({
						calendarSources: [],
						eventSchemas: kernel.eventSchemas,
						savedViews: kernel.savedViews.map((row) => ({ ...row, ...owner })),
						entitySchemas: kernel.entitySchemas.map((row) => ({ ...row, ...owner })),
						signalSchemas: kernel.signalSchemas.map((row) => ({ ...row, ...owner })),
						relationshipSchemas: kernel.relationshipSchemas.map((row) =>
							Object.assign({}, row, owner),
						),
					}),
				);
			});

			const readPinnedRows = Effect.fn("DefinitionRepository.readPinnedRows")(function* (
				context: DefinitionReadContext,
			) {
				const [owner] = yield* session.run((db) =>
					db
						.select({ pluginId: schema.plugin.id, packageId: schema.plugin.packageId })
						.from(schema.pluginRevision)
						.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginRevision.pluginId))
						.where(
							and(
								eq(schema.pluginRevision.id, context.pluginRevisionId),
								eq(schema.plugin.id, context.pluginId),
							),
						),
				);
				if (!owner) {
					return yield* new DefinitionReadUnavailable({ context });
				}
				const revision = yield* catalog.revision(context.pluginRevisionId);
				return {
					savedViews: revision.savedViews.map((row) => ({ ...row, ...owner })),
					eventSchemas: revision.eventSchemas.map((row) => ({ ...row, ...owner })),
					entitySchemas: revision.entitySchemas.map((row) => ({ ...row, ...owner })),
					signalSchemas: revision.signalSchemas.map((row) => ({ ...row, ...owner })),
					calendarSources: revision.calendarSources.map((row) => ({ ...row, ...owner })),
					relationshipSchemas: revision.relationshipSchemas.map((row) =>
						Object.assign({}, row, owner),
					),
				};
			});

			const revisionDeclarationReaders: {
				readonly [K in keyof RevisionDeclarations]: (
					input: RevisionDeclarationQuery<K>,
				) => Effect.Effect<undefined | RevisionDeclarations[K], DbError>;
			} = {
				entity: Effect.fnUntraced(function* (input) {
					const [row] = yield* session.run((db) =>
						db
							.select({ propertiesSchema: schema.definitionEntitySchema.propertiesSchema })
							.from(schema.definitionEntitySchema)
							.where(
								and(
									eq(schema.definitionEntitySchema.pluginRevisionId, input.revisionId),
									eq(schema.definitionEntitySchema.slug, input.slug),
								),
							)
							.limit(1),
					);
					return row;
				}),
				event: Effect.fnUntraced(function* (input) {
					const { entitySchemaSlug } = input;
					if (entitySchemaSlug === undefined) {
						return undefined;
					}
					const [row] = yield* session.run((db) =>
						db
							.select({
								projection: schema.definitionEventSchema.projection,
								eventGroup: schema.definitionEventSchema.eventGroup,
								propertiesSchema: schema.definitionEventSchema.propertiesSchema,
							})
							.from(schema.definitionEventSchema)
							.innerJoin(
								schema.definitionEntitySchema,
								eq(schema.definitionEntitySchema.id, schema.definitionEventSchema.entitySchemaId),
							)
							.where(
								and(
									eq(schema.definitionEntitySchema.pluginRevisionId, input.revisionId),
									eq(schema.definitionEntitySchema.slug, entitySchemaSlug),
									eq(schema.definitionEventSchema.slug, input.slug),
								),
							)
							.limit(1),
					);
					if (!row) {
						return undefined;
					}
					return {
						propertiesSchema: row.propertiesSchema,
						...(row.projection === null ? {} : { projection: row.projection }),
						...(row.eventGroup === null ? {} : { eventGroup: row.eventGroup }),
					};
				}),
				relationship: Effect.fnUntraced(function* (input) {
					const [row] = yield* session.run((db) =>
						db
							.select({
								name: schema.definitionRelationshipSchema.name,
								slug: schema.definitionRelationshipSchema.slug,
								projection: schema.definitionRelationshipSchema.projection,
								userWritePolicy: schema.definitionRelationshipSchema.userWritePolicy,
								propertiesSchema: schema.definitionRelationshipSchema.propertiesSchema,
								sourceEntitySchemaSlug: schema.definitionRelationshipSchema.sourceEntitySchemaSlug,
								targetEntitySchemaSlug: schema.definitionRelationshipSchema.targetEntitySchemaSlug,
							})
							.from(schema.definitionRelationshipSchema)
							.where(
								and(
									eq(schema.definitionRelationshipSchema.pluginRevisionId, input.revisionId),
									eq(schema.definitionRelationshipSchema.slug, input.slug),
								),
							)
							.limit(1),
					);
					if (!row) {
						return undefined;
					}
					const { projection, userWritePolicy, ...definition } = row;
					return {
						...definition,
						...(projection === null ? {} : { projection }),
						...(userWritePolicy === null ? {} : { userWritePolicy }),
					};
				}),
			};
			const findRevisionDeclaration = Effect.fn("DefinitionRepository.findRevisionDeclaration")(
				function* <K extends keyof RevisionDeclarations>(input: RevisionDeclarationQuery<K>) {
					return yield* revisionDeclarationReaders[input.kind](input);
				},
			);

			const getSnapshotForContext = Effect.fn("DefinitionRepository.getSnapshotForContext")(
				function* (context: DefinitionReadContext, userId: null | UserId) {
					const available =
						userId === null
							? (yield* catalog.globalPlugins()).filter(
									({ pluginId }) => pluginId === context.pluginId,
								)
							: (yield* catalog.userPlugins(userId)).filter(
									({ pluginId, isListed }) => pluginId === context.pluginId && isListed,
								);
					if (available.length === 0) {
						return yield* new DefinitionReadUnavailable({ context });
					}
					const current =
						userId === null ? yield* readGlobalRows() : yield* readUserRows(userId, effective);
					const pinned = yield* readPinnedRows(context);
					const ownEntityIds = new Set(
						current.entitySchemas
							.filter(({ pluginId }) => pluginId === context.pluginId)
							.map(({ id }) => id),
					);
					return yield* toSnapshot({
						savedViews: [
							...current.savedViews.filter(({ pluginId }) => pluginId !== context.pluginId),
							...pinned.savedViews,
						],
						entitySchemas: [
							...current.entitySchemas.filter(({ pluginId }) => pluginId !== context.pluginId),
							...pinned.entitySchemas,
						],
						signalSchemas: [
							...current.signalSchemas.filter(({ pluginId }) => pluginId !== context.pluginId),
							...pinned.signalSchemas,
						],
						calendarSources: [
							...current.calendarSources.filter(({ pluginId }) => pluginId !== context.pluginId),
							...pinned.calendarSources,
						],
						eventSchemas: [
							...current.eventSchemas.filter(
								({ entitySchemaId }) => !ownEntityIds.has(entitySchemaId),
							),
							...pinned.eventSchemas,
						],
						relationshipSchemas: [
							...current.relationshipSchemas.filter(
								({ pluginId }) => pluginId !== context.pluginId,
							),
							...pinned.relationshipSchemas,
						],
					});
				},
			);

			const findEntitySchemaRefreshIntervals = Effect.fn(
				"DefinitionRepository.findEntitySchemaRefreshIntervals",
			)(function* (
				references: ReadonlyArray<{ readonly slug: string; readonly pluginId: string }>,
			) {
				if (references.length === 0) {
					return new Map<string, number>();
				}
				const rows = yield* session.run((db) =>
					db
						.select({
							pluginId: schema.plugin.id,
							slug: schema.definitionEntitySchema.slug,
							declared: schema.definitionEntitySchema.refreshIntervalDays,
							override: schema.entitySchemaRefreshOverride.refreshIntervalDays,
						})
						.from(schema.plugin)
						.innerJoin(
							schema.definitionEntitySchema,
							eq(schema.definitionEntitySchema.pluginRevisionId, schema.plugin.activeRevisionId),
						)
						.leftJoin(
							schema.entitySchemaRefreshOverride,
							and(
								eq(schema.entitySchemaRefreshOverride.pluginId, schema.plugin.id),
								eq(schema.entitySchemaRefreshOverride.slug, schema.definitionEntitySchema.slug),
							),
						)
						.where(
							or(
								...references.map((reference) =>
									and(
										eq(schema.plugin.id, reference.pluginId),
										eq(schema.definitionEntitySchema.slug, reference.slug),
									),
								),
							),
						),
				);
				return new Map(
					rows.flatMap(({ slug, pluginId, declared, override }) => {
						const days = override ?? declared;
						return days === null ? [] : [[`${pluginId}:${slug}`, days] as const];
					}),
				);
			});
			const setEntitySchemaRefreshOverride = Effect.fn(
				"DefinitionRepository.setEntitySchemaRefreshOverride",
			)(function* (input: {
				readonly slug: string;
				readonly pluginId: string;
				readonly refreshIntervalDays: null | number;
			}) {
				const { refreshIntervalDays } = input;
				if (refreshIntervalDays === null) {
					yield* session.run((db) =>
						db
							.delete(schema.entitySchemaRefreshOverride)
							.where(
								and(
									eq(schema.entitySchemaRefreshOverride.slug, input.slug),
									eq(schema.entitySchemaRefreshOverride.pluginId, input.pluginId),
								),
							),
					);
					return;
				}
				yield* session.run((db) =>
					db
						.insert(schema.entitySchemaRefreshOverride)
						.values({ slug: input.slug, refreshIntervalDays, pluginId: input.pluginId })
						.onConflictDoUpdate({
							set: { refreshIntervalDays },
							target: [
								schema.entitySchemaRefreshOverride.pluginId,
								schema.entitySchemaRefreshOverride.slug,
							],
						}),
				);
			});
			const findUserEntitySchemas = Effect.fn("DefinitionRepository.findUserEntitySchemas")(
				function* (userId: UserId, references: ReadonlyArray<DeclarationReference>) {
					if (references.length === 0) {
						return {};
					}
					const rows = yield* catalog.forUser(userId);
					const events = eventsByEntitySchema(byPosition(rows.eventSchemas));
					return yield* recordByIdentity(
						"entity",
						placed(rows.entitySchemas, effective, matches(references)).map((row) =>
							toEntitySchema(row, events.get(row.id) ?? []),
						),
					);
				},
			);

			const findUserRelationshipSchemas = Effect.fn(
				"DefinitionRepository.findUserRelationshipSchemas",
			)(function* (userId: UserId, references: ReadonlyArray<DeclarationReference>) {
				if (references.length === 0) {
					return {};
				}
				const rows = yield* catalog.forUser(userId);
				return yield* recordByIdentity(
					"relationship",
					placed(rows.relationshipSchemas, effective, matches(references)).map(
						toRelationshipSchema,
					),
				);
			});

			const findGlobalRelationshipSchemas = Effect.fn(
				"DefinitionRepository.findGlobalRelationshipSchemas",
			)(function* (references: ReadonlyArray<DeclarationReference>) {
				if (references.length === 0) {
					return {};
				}
				const rows = yield* catalog.global();
				return yield* recordByIdentity(
					"relationship",
					ordered(rows.relationshipSchemas.filter(matches(references)), true).map(
						toRelationshipSchema,
					),
				);
			});

			const getUserEntityRelationshipDefinitions = Effect.fn(
				"DefinitionRepository.getUserEntityRelationshipDefinitions",
			)(function* (userId: UserId) {
				const rows = yield* catalog.forUser(userId);
				return yield* toEntityRelationshipDefinitions({
					entitySchemas: ordered(placed(rows.entitySchemas, effective)),
					relationshipSchemas: ordered(placed(rows.relationshipSchemas, effective), true),
				});
			});

			const getGlobalEntityRelationshipDefinitions = Effect.fn(
				"DefinitionRepository.getGlobalEntityRelationshipDefinitions",
			)(function* () {
				const rows = yield* catalog.global();
				return yield* toEntityRelationshipDefinitions({
					entitySchemas: ordered(rows.entitySchemas),
					relationshipSchemas: ordered(rows.relationshipSchemas, true),
				});
			});

			const listUserSignalSchemas = Effect.fn("DefinitionRepository.listUserSignalSchemas")(
				function* (userId: UserId) {
					const rows = yield* catalog.forUser(userId);
					return ordered(placed(rows.signalSchemas, effective)).map(toSignalSchema);
				},
			);

			const findUserSignalSchema = Effect.fn("DefinitionRepository.findUserSignalSchema")(
				function* (
					userId: UserId,
					reference: DeclarationReference,
					options: ListedOption = effective,
				) {
					const rows = yield* catalog.forUser(userId);
					return (
						(yield* recordByIdentity(
							"signal",
							placed(rows.signalSchemas, options, matches([reference])).map(toSignalSchema),
						))[definitionKey("signal", reference.owner, reference.slug)] ?? null
					);
				},
			);

			const findGlobalEntitySchema = Effect.fn("DefinitionRepository.findGlobalEntitySchema")(
				function* (reference: DeclarationReference) {
					const rows = yield* catalog.global();
					const row = (yield* recordByIdentity(
						"entity",
						rows.entitySchemas.filter(matches([reference])),
					))[definitionKey("entity", reference.owner, reference.slug)];
					if (!row) {
						return null;
					}
					return toEntitySchema(
						row,
						byPosition(rows.eventSchemas.filter(({ entitySchemaId }) => entitySchemaId === row.id)),
					);
				},
			);

			const findGlobalEventSchema = Effect.fn("DefinitionRepository.findGlobalEventSchema")(
				function* (reference: EventSchemaReference) {
					const rows = yield* catalog.global();
					const row = rows.eventSchemas.find(
						(event) =>
							matches([reference])(event) && event.entitySchemaSlug === reference.entitySchemaSlug,
					);
					return row ? toEventSchema(row) : null;
				},
			);

			const findGlobalRelationshipSchema = Effect.fn(
				"DefinitionRepository.findGlobalRelationshipSchema",
			)(function* (reference: DeclarationReference) {
				return (
					(yield* findGlobalRelationshipSchemas([reference]))[
						definitionKey("relationship", reference.owner, reference.slug)
					] ?? null
				);
			});

			const findGlobalSignalSchema = Effect.fn("DefinitionRepository.findGlobalSignalSchema")(
				function* (reference: DeclarationReference) {
					const signalSchemas: ReadonlyArray<CatalogSignalSchema> =
						reference.owner.kind === "kernel"
							? (yield* catalog.kernel).signalSchemas.map((row) =>
									Object.assign({}, row, {
										pluginId: null,
										packageId: null,
										isEffective: true,
										pluginScope: null,
									}),
								)
							: (yield* catalog.global()).signalSchemas;
					return (
						(yield* recordByIdentity(
							"signal",
							signalSchemas.filter(matches([reference])).map(toSignalSchema),
						))[definitionKey("signal", reference.owner, reference.slug)] ?? null
					);
				},
			);

			const listUserStateParents = Effect.fn("DefinitionRepository.listUserStateParents")(
				function* (userId: UserId, reference: EntitySchemaReference) {
					const rows = yield* catalog.forUser(userId);
					return placed(
						rows.entitySchemas,
						effective,
						(row) =>
							row.pluginId === definitionOwnerPluginId(reference.owner) &&
							(row.userState?.children ?? []).some(
								({ entitySchemaSlug }) => entitySchemaSlug === reference.slug,
							),
					).map(({ slug, pluginId, userState }) => ({ slug, pluginId, userState }));
				},
			);
			return {
				readPinnedRows,
				listUserStateParents,
				findUserSignalSchema,
				getSnapshotForContext,
				findGlobalEventSchema,
				findUserEntitySchemas,
				listUserSignalSchemas,
				findGlobalEntitySchema,
				findGlobalSignalSchema,
				findRevisionDeclaration,
				replaceKernelDefinitions,
				writeRevisionDefinitions,
				findUserRelationshipSchemas,
				findGlobalRelationshipSchema,
				findGlobalRelationshipSchemas,
				setEntitySchemaRefreshOverride,
				findEntitySchemaRefreshIntervals,
				readKernelSource: readKernelRows(),
				getUserEntityRelationshipDefinitions,
				getGlobalSnapshot: Effect.flatMap(readGlobalRows(), toSnapshot),
				getGlobalEntityRelationshipDefinitions: getGlobalEntityRelationshipDefinitions(),
				getUserSnapshot: (userId: UserId, options: ListedOption) =>
					Effect.flatMap(readUserRows(userId, options), toSnapshot),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(DefinitionCatalog.layer),
	);
}
