import type { UserId } from "@ryot-app/contract/schema/brands";
import {
	and,
	asc,
	desc,
	eq,
	getTableColumns,
	inArray,
	isNull,
	notInArray,
	sql,
	type InferSelectViewModel,
	type SQL,
} from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

import type {
	DefinitionSnapshot,
	DefinitionSource,
	EntitySchemaSnapshot,
	EventSchemaDefinition,
	RelationshipSchemaDefinition,
	SavedViewDefinition,
	SignalSchemaDefinition,
} from "./snapshot";
import type { RevisionDefinitions } from "./source";

type EntitySchemaRow = InferSelectViewModel<typeof schema.globalEntitySchema>;
type EventSchemaRow = InferSelectViewModel<typeof schema.globalEventSchema>;
type RelationshipSchemaRow = InferSelectViewModel<typeof schema.globalRelationshipSchema>;
type SignalSchemaRow = InferSelectViewModel<typeof schema.globalSignalSchema>;
type SavedViewRow = InferSelectViewModel<typeof schema.globalSavedView>;

type EventSchemaFields = Pick<
	EventSchemaRow,
	"entitySchemaId" | "name" | "propertiesSchema" | "slug"
>;

type DefinitionRows = {
	readonly savedViews: ReadonlyArray<SavedViewRow>;
	readonly entitySchemas: ReadonlyArray<EntitySchemaRow>;
	readonly eventSchemas: ReadonlyArray<EventSchemaFields>;
	readonly signalSchemas: ReadonlyArray<Omit<SignalSchemaRow, "pluginSlug">>;
	readonly relationshipSchemas: ReadonlyArray<Omit<RelationshipSchemaRow, "pluginSlug">>;
};

type ListedOption = { readonly listed: boolean };

const toEventSchema = (
	row: Pick<EventSchemaRow, "name" | "pluginId" | "propertiesSchema" | "slug">,
): EventSchemaDefinition => ({
	name: row.name,
	slug: row.slug,
	pluginId: row.pluginId,
	propertiesSchema: row.propertiesSchema,
});

const toEntitySchema = (
	row: EntitySchemaRow,
	eventSchemas: ReadonlyArray<EventSchemaFields>,
): EntitySchemaSnapshot => ({
	icon: row.icon,
	name: row.name,
	slug: row.slug,
	pluginId: row.pluginId,
	pluginSlug: row.pluginSlug,
	propertiesSchema: row.propertiesSchema,
	mergeIdentityProperties: row.mergeIdentityProperties,
	...(row.userState ? { userState: row.userState } : {}),
	eventSchemas: Object.fromEntries(
		eventSchemas.map((event) => [event.slug, toEventSchema({ ...event, pluginId: row.pluginId })]),
	),
});

const toRelationshipSchema = (
	row: Omit<RelationshipSchemaRow, "pluginSlug">,
): RelationshipSchemaDefinition => ({
	name: row.name,
	slug: row.slug,
	pluginId: row.pluginId,
	propertiesSchema: row.propertiesSchema,
	sourceEntitySchemaSlug: row.sourceEntitySchemaSlug,
	targetEntitySchemaSlug: row.targetEntitySchemaSlug,
});

const toSignalSchema = (row: Omit<SignalSchemaRow, "pluginSlug">): SignalSchemaDefinition => ({
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
	pluginSlug: row.pluginSlug,
	dataSources: row.dataSources,
});

const recordBySlug = <Definition extends { readonly slug: string }>(
	kind: string,
	definitions: ReadonlyArray<Definition>,
) =>
	Effect.suspend(() => {
		const record: Record<string, Definition> = {};
		for (const definition of definitions) {
			if (Object.hasOwn(record, definition.slug)) {
				return Effect.die(new Error(`Duplicate ${kind} slug: ${definition.slug}`));
			}
			record[definition.slug] = definition;
		}
		return Effect.succeed(record);
	});

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
		savedViews: yield* recordBySlug("saved view", rows.savedViews.map(toSavedView)),
		signalSchemas: yield* recordBySlug("signal schema", rows.signalSchemas.map(toSignalSchema)),
		relationshipSchemas: yield* recordBySlug(
			"relationship schema",
			rows.relationshipSchemas.map(toRelationshipSchema),
		),
		entitySchemas: yield* recordBySlug(
			"entity schema",
			rows.entitySchemas.map((row) => toEntitySchema(row, events.get(row.id) ?? [])),
		),
	} satisfies DefinitionSnapshot;
});

const toSource = (snapshot: DefinitionSnapshot): DefinitionSource => ({
	savedViews: Object.values(snapshot.savedViews),
	signalSchemas: Object.values(snapshot.signalSchemas),
	relationshipSchemas: Object.values(snapshot.relationshipSchemas),
	entitySchemas: Object.values(snapshot.entitySchemas).map(({ eventSchemas, ...entitySchema }) =>
		Object.assign({}, entitySchema, { eventSchemas: Object.values(eventSchemas) }),
	),
});

const scopeRank = (pluginScope: PgColumn) =>
	sql`case when ${pluginScope} is null then 0 when ${pluginScope} = 'system' then 1 else 2 end`;

const globalRank = (pluginId: PgColumn) => sql`${pluginId} is not null`;

const userDefinitionOrder = (
	view: { pluginScope: PgColumn; pluginSlug: PgColumn; position: PgColumn },
	pluginsFirst = false,
) => [
	pluginsFirst ? desc(scopeRank(view.pluginScope)) : asc(scopeRank(view.pluginScope)),
	asc(view.pluginSlug),
	asc(view.position),
];

const globalDefinitionOrder = (
	view: { pluginId: PgColumn; pluginSlug: PgColumn; position: PgColumn },
	pluginsFirst = false,
) => [
	pluginsFirst ? desc(globalRank(view.pluginId)) : asc(globalRank(view.pluginId)),
	asc(view.pluginSlug),
	asc(view.position),
];

const userWhere = (
	view: { userId: PgColumn; isEffective: PgColumn },
	userId: UserId,
	options: ListedOption,
	...conditions: ReadonlyArray<SQL | undefined>
) =>
	and(
		eq(view.userId, userId),
		options.listed ? undefined : eq(view.isEffective, true),
		...conditions,
	);

const effective = { listed: false } as const;

const pruneKernelRows = Effect.fn(function* (
	table:
		| typeof schema.definitionEntitySchema
		| typeof schema.definitionRelationshipSchema
		| typeof schema.definitionSignalSchema
		| typeof schema.definitionSavedView,
	slugs: ReadonlyArray<string>,
) {
	const db = yield* Database;
	yield* mapDatabaseErrors(
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

export class DefinitionRepository extends Context.Service<DefinitionRepository>()(
	"DefinitionRepository",
	{
		make: Effect.sync(() => {
			const writeRevisionDefinitions = Effect.fn("DefinitionRepository.writeRevisionDefinitions")(
				function* (input: {
					readonly pluginId: string;
					readonly pluginRevisionId: string;
					readonly definitions: RevisionDefinitions;
				}) {
					const db = yield* Database;
					const { pluginId, definitions, pluginRevisionId } = input;
					if (definitions.entitySchemas.length > 0) {
						const entities = yield* mapDatabaseErrors(
							db
								.insert(schema.definitionEntitySchema)
								.values(
									definitions.entitySchemas.map((definition, position) => ({
										pluginId,
										position,
										pluginRevisionId,
										icon: definition.icon,
										name: definition.name,
										slug: definition.slug,
										userState: definition.userState ?? null,
										propertiesSchema: definition.propertiesSchema,
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
										propertiesSchema: event.propertiesSchema,
									}))
								: [];
						});
						if (events.length > 0) {
							yield* mapDatabaseErrors(db.insert(schema.definitionEventSchema).values(events));
						}
					}
					if (definitions.relationshipSchemas.length > 0) {
						yield* mapDatabaseErrors(
							db
								.insert(schema.definitionRelationshipSchema)
								.values(
									definitions.relationshipSchemas.map((definition, position) => ({
										pluginId,
										position,
										pluginRevisionId,
										name: definition.name,
										slug: definition.slug,
										propertiesSchema: definition.propertiesSchema,
										sourceEntitySchemaSlug: definition.sourceEntitySchemaSlug,
										targetEntitySchemaSlug: definition.targetEntitySchemaSlug,
									})),
								),
						);
					}
					if (definitions.signalSchemas.length > 0) {
						yield* mapDatabaseErrors(
							db
								.insert(schema.definitionSignalSchema)
								.values(
									definitions.signalSchemas.map((definition, position) => ({
										pluginId,
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
						yield* mapDatabaseErrors(
							db
								.insert(schema.definitionSavedView)
								.values(
									definitions.savedViews.map((definition, position) => ({
										pluginId,
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
					if (definitions.importSources.length > 0) {
						yield* mapDatabaseErrors(
							db
								.insert(schema.definitionImportSource)
								.values(
									definitions.importSources.map((definition, position) => ({
										pluginId,
										position,
										pluginRevisionId,
										name: definition.name,
										slug: definition.slug,
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
						yield* mapDatabaseErrors(
							db
								.insert(schema.definitionIntegrationProvider)
								.values(
									definitions.integrationProviders.map((definition, position) => ({
										pluginId,
										position,
										pluginRevisionId,
										lot: definition.lot,
										name: definition.name,
										slug: definition.slug,
										description: definition.description,
										settingsSchema: definition.settingsSchema,
										requiresProKey: definition.requiresProKey ?? false,
										scriptSlug: definition.lot === "push" ? null : definition.scriptSlug,
									})),
								),
						);
					}
				},
			);

			const replaceKernelDefinitions = Effect.fn("DefinitionRepository.replaceKernelDefinitions")(
				function* (source: DefinitionSource) {
					const db = yield* Database;
					const entities =
						source.entitySchemas.length > 0
							? yield* mapDatabaseErrors(
									db
										.insert(schema.definitionEntitySchema)
										.values(
											source.entitySchemas.map((definition, position) => ({
												position,
												pluginId: null,
												icon: definition.icon,
												name: definition.name,
												slug: definition.slug,
												pluginRevisionId: null,
												userState: definition.userState ?? null,
												propertiesSchema: definition.propertiesSchema,
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
												position: sql`excluded.position`,
												userState: sql`excluded.user_state`,
												propertiesSchema: sql`excluded.properties_schema`,
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
							yield* mapDatabaseErrors(
								db
									.insert(schema.definitionEventSchema)
									.values(
										definition.eventSchemas.map((event, position) => ({
											position,
											entitySchemaId,
											name: event.name,
											slug: event.slug,
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
											propertiesSchema: sql`excluded.properties_schema`,
										},
									}),
							);
						}
						yield* mapDatabaseErrors(
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
						yield* mapDatabaseErrors(
							db
								.insert(schema.definitionRelationshipSchema)
								.values(
									source.relationshipSchemas.map((definition, position) => ({
										position,
										pluginId: null,
										name: definition.name,
										slug: definition.slug,
										pluginRevisionId: null,
										propertiesSchema: definition.propertiesSchema,
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
						yield* mapDatabaseErrors(
							db
								.insert(schema.definitionSignalSchema)
								.values(
									source.signalSchemas.map((definition, position) => ({
										position,
										pluginId: null,
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
						yield* mapDatabaseErrors(
							db
								.insert(schema.definitionSavedView)
								.values(
									source.savedViews.map((definition, position) => ({
										position,
										pluginId: null,
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
				},
			);

			const readUserRows = Effect.fn("DefinitionRepository.readUserRows")(function* (
				userId: UserId,
				options: ListedOption,
			) {
				const db = yield* Database;
				const entitySchemas = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.userEntitySchema)
						.where(userWhere(schema.userEntitySchema, userId, options))
						.orderBy(...userDefinitionOrder(schema.userEntitySchema)),
				);
				const eventSchemas = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.userEventSchema)
						.where(userWhere(schema.userEventSchema, userId, options))
						.orderBy(asc(schema.userEventSchema.position)),
				);
				const relationshipSchemas = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.userRelationshipSchema)
						.where(userWhere(schema.userRelationshipSchema, userId, options))
						.orderBy(...userDefinitionOrder(schema.userRelationshipSchema, true)),
				);
				const signalSchemas = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.userSignalSchema)
						.where(userWhere(schema.userSignalSchema, userId, options))
						.orderBy(...userDefinitionOrder(schema.userSignalSchema)),
				);
				const savedViews = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.userSavedView)
						.where(userWhere(schema.userSavedView, userId, options))
						.orderBy(...userDefinitionOrder(schema.userSavedView)),
				);
				return { savedViews, eventSchemas, entitySchemas, signalSchemas, relationshipSchemas };
			});

			const readGlobalRows = Effect.fn("DefinitionRepository.readGlobalRows")(function* () {
				const db = yield* Database;
				const entitySchemas = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.globalEntitySchema)
						.orderBy(...globalDefinitionOrder(schema.globalEntitySchema)),
				);
				const eventSchemas = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.globalEventSchema)
						.orderBy(asc(schema.globalEventSchema.position)),
				);
				const relationshipSchemas = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.globalRelationshipSchema)
						.orderBy(...globalDefinitionOrder(schema.globalRelationshipSchema, true)),
				);
				const signalSchemas = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.globalSignalSchema)
						.orderBy(...globalDefinitionOrder(schema.globalSignalSchema)),
				);
				const savedViews = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.globalSavedView)
						.orderBy(...globalDefinitionOrder(schema.globalSavedView)),
				);
				return { savedViews, eventSchemas, entitySchemas, signalSchemas, relationshipSchemas };
			});

			const readKernelRows = Effect.fn("DefinitionRepository.readKernelRows")(function* () {
				const db = yield* Database;
				const entitySchemas = yield* mapDatabaseErrors(
					db
						.select({
							...getTableColumns(schema.definitionEntitySchema),
							pluginSlug: schema.plugin.slug,
						})
						.from(schema.definitionEntitySchema)
						.leftJoin(schema.plugin, eq(schema.plugin.id, schema.definitionEntitySchema.pluginId))
						.where(isNull(schema.definitionEntitySchema.pluginRevisionId))
						.orderBy(asc(schema.definitionEntitySchema.position)),
				);
				const eventSchemas =
					entitySchemas.length > 0
						? yield* mapDatabaseErrors(
								db
									.select()
									.from(schema.definitionEventSchema)
									.where(
										inArray(
											schema.definitionEventSchema.entitySchemaId,
											entitySchemas.map(({ id }) => id),
										),
									)
									.orderBy(asc(schema.definitionEventSchema.position)),
							)
						: [];
				const relationshipSchemas = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.definitionRelationshipSchema)
						.where(isNull(schema.definitionRelationshipSchema.pluginRevisionId))
						.orderBy(asc(schema.definitionRelationshipSchema.position)),
				);
				const signalSchemas = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.definitionSignalSchema)
						.where(isNull(schema.definitionSignalSchema.pluginRevisionId))
						.orderBy(asc(schema.definitionSignalSchema.position)),
				);
				const savedViews = yield* mapDatabaseErrors(
					db
						.select({
							...getTableColumns(schema.definitionSavedView),
							pluginSlug: schema.plugin.slug,
						})
						.from(schema.definitionSavedView)
						.leftJoin(schema.plugin, eq(schema.plugin.id, schema.definitionSavedView.pluginId))
						.where(isNull(schema.definitionSavedView.pluginRevisionId))
						.orderBy(asc(schema.definitionSavedView.position)),
				);
				return toSource(
					yield* toSnapshot({
						savedViews,
						eventSchemas,
						entitySchemas,
						signalSchemas,
						relationshipSchemas,
					}),
				);
			});

			const findUserEntitySchemas = Effect.fn("DefinitionRepository.findUserEntitySchemas")(
				function* (userId: UserId, slugs: ReadonlyArray<string>) {
					if (slugs.length === 0) {
						return {};
					}
					const db = yield* Database;
					const entitySchemas = yield* mapDatabaseErrors(
						db
							.select()
							.from(schema.userEntitySchema)
							.where(
								userWhere(
									schema.userEntitySchema,
									userId,
									effective,
									inArray(schema.userEntitySchema.slug, [...slugs]),
								),
							),
					);
					const eventSchemas =
						entitySchemas.length > 0
							? yield* mapDatabaseErrors(
									db
										.select()
										.from(schema.definitionEventSchema)
										.where(
											inArray(
												schema.definitionEventSchema.entitySchemaId,
												entitySchemas.map(({ id }) => id),
											),
										)
										.orderBy(asc(schema.definitionEventSchema.position)),
								)
							: [];
					const events = eventsByEntitySchema(eventSchemas);
					return yield* recordBySlug(
						"entity schema",
						entitySchemas.map((row) => toEntitySchema(row, events.get(row.id) ?? [])),
					);
				},
			);

			const listUserEventSchemas = Effect.fn("DefinitionRepository.listUserEventSchemas")(
				function* (userId: UserId, entitySchemaSlug: string) {
					const db = yield* Database;
					const rows = yield* mapDatabaseErrors(
						db
							.select()
							.from(schema.userEventSchema)
							.where(
								userWhere(
									schema.userEventSchema,
									userId,
									effective,
									eq(schema.userEventSchema.entitySchemaSlug, entitySchemaSlug),
								),
							)
							.orderBy(asc(schema.userEventSchema.position)),
					);
					return rows.map(toEventSchema);
				},
			);

			const findUserRelationshipSchemas = Effect.fn(
				"DefinitionRepository.findUserRelationshipSchemas",
			)(function* (userId: UserId, slugs: ReadonlyArray<string>) {
				if (slugs.length === 0) {
					return {};
				}
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.userRelationshipSchema)
						.where(
							userWhere(
								schema.userRelationshipSchema,
								userId,
								effective,
								inArray(schema.userRelationshipSchema.slug, [...slugs]),
							),
						),
				);
				return yield* recordBySlug("relationship schema", rows.map(toRelationshipSchema));
			});

			const listUserSignalSchemas = Effect.fn("DefinitionRepository.listUserSignalSchemas")(
				function* (userId: UserId, options: ListedOption = effective) {
					const db = yield* Database;
					const rows = yield* mapDatabaseErrors(
						db
							.select()
							.from(schema.userSignalSchema)
							.where(userWhere(schema.userSignalSchema, userId, options))
							.orderBy(...userDefinitionOrder(schema.userSignalSchema)),
					);
					return rows.map(toSignalSchema);
				},
			);

			const findUserSignalSchema = Effect.fn("DefinitionRepository.findUserSignalSchema")(
				function* (userId: UserId, slug: string, options: ListedOption = effective) {
					const db = yield* Database;
					const rows = yield* mapDatabaseErrors(
						db
							.select()
							.from(schema.userSignalSchema)
							.where(
								userWhere(
									schema.userSignalSchema,
									userId,
									options,
									eq(schema.userSignalSchema.slug, slug),
								),
							),
					);
					return (yield* recordBySlug("signal schema", rows.map(toSignalSchema)))[slug] ?? null;
				},
			);

			const listUserSavedViews = Effect.fn("DefinitionRepository.listUserSavedViews")(function* (
				userId: UserId,
				options: ListedOption,
			) {
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.userSavedView)
						.where(userWhere(schema.userSavedView, userId, options))
						.orderBy(...userDefinitionOrder(schema.userSavedView)),
				);
				return rows.map(toSavedView);
			});

			const findGlobalEntitySchema = Effect.fn("DefinitionRepository.findGlobalEntitySchema")(
				function* (slug: string) {
					const db = yield* Database;
					const rows = yield* mapDatabaseErrors(
						db
							.select()
							.from(schema.globalEntitySchema)
							.where(eq(schema.globalEntitySchema.slug, slug)),
					);
					const row = (yield* recordBySlug("entity schema", rows))[slug];
					if (!row) {
						return null;
					}
					const events = yield* mapDatabaseErrors(
						db
							.select()
							.from(schema.globalEventSchema)
							.where(eq(schema.globalEventSchema.entitySchemaId, row.id))
							.orderBy(asc(schema.globalEventSchema.position)),
					);
					return toEntitySchema(row, events);
				},
			);

			const findGlobalEventSchema = Effect.fn("DefinitionRepository.findGlobalEventSchema")(
				function* (entitySchemaSlug: string, slug: string) {
					const db = yield* Database;
					const [row] = yield* mapDatabaseErrors(
						db
							.select()
							.from(schema.globalEventSchema)
							.where(
								and(
									eq(schema.globalEventSchema.entitySchemaSlug, entitySchemaSlug),
									eq(schema.globalEventSchema.slug, slug),
								),
							)
							.limit(1),
					);
					return row ? toEventSchema(row) : null;
				},
			);

			const findGlobalRelationshipSchema = Effect.fn(
				"DefinitionRepository.findGlobalRelationshipSchema",
			)(function* (slug: string) {
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.globalRelationshipSchema)
						.where(eq(schema.globalRelationshipSchema.slug, slug)),
				);
				return (
					(yield* recordBySlug("relationship schema", rows.map(toRelationshipSchema)))[slug] ?? null
				);
			});

			const findGlobalSignalSchema = Effect.fn("DefinitionRepository.findGlobalSignalSchema")(
				function* (slug: string) {
					const db = yield* Database;
					const rows = yield* mapDatabaseErrors(
						db
							.select()
							.from(schema.globalSignalSchema)
							.where(eq(schema.globalSignalSchema.slug, slug)),
					);
					return (yield* recordBySlug("signal schema", rows.map(toSignalSchema)))[slug] ?? null;
				},
			);

			const listGlobalSignalSchemas = Effect.fn("DefinitionRepository.listGlobalSignalSchemas")(
				function* () {
					const db = yield* Database;
					const rows = yield* mapDatabaseErrors(
						db
							.select()
							.from(schema.globalSignalSchema)
							.orderBy(...globalDefinitionOrder(schema.globalSignalSchema)),
					);
					return rows.map(toSignalSchema);
				},
			);

			return {
				listUserSavedViews,
				listUserEventSchemas,
				findUserSignalSchema,
				findGlobalEventSchema,
				findUserEntitySchemas,
				listUserSignalSchemas,
				findGlobalEntitySchema,
				findGlobalSignalSchema,
				listGlobalSignalSchemas,
				replaceKernelDefinitions,
				writeRevisionDefinitions,
				findUserRelationshipSchemas,
				findGlobalRelationshipSchema,
				readKernelSource: readKernelRows(),
				getGlobalSnapshot: Effect.flatMap(readGlobalRows(), toSnapshot),
				getUserSnapshot: (userId: UserId, options: ListedOption) =>
					Effect.flatMap(readUserRows(userId, options), toSnapshot),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
