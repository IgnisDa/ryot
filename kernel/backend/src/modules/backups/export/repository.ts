import type { EntitySourceReference } from "@ryot-app/contract/modules/ryotql/entity-source";
import type { BackupRunId, PublicationId, UserId } from "@ryot-app/contract/schema/brands";
import {
	and,
	asc,
	eq,
	exists,
	getTableColumns,
	gt,
	inArray,
	isNotNull,
	isNull,
	or,
	sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Context, Effect, Layer, Schema } from "effect";

import { DefinitionCatalog } from "#modules/definitions/catalog";
import { DatabaseSession } from "#platform/db/session";
import * as assistantTables from "#schema/tables/assistant";
import * as schema from "#schema/tables/combined";
import * as pageSchema from "#schema/tables/pages";

import { ARCHIVE_LIMITS } from "../archive/archive";
import { archiveEntryTooLarge } from "../archive/error";

const propertyReferenceDeclarationSchema = Schema.Struct({
	slug: Schema.String,
	paths: Schema.Array(Schema.String),
	pluginId: Schema.NullOr(Schema.String),
	entitySchemaSlug: Schema.NullOr(Schema.String),
	entitySchemaPluginId: Schema.NullOr(Schema.String),
	kind: Schema.Literals([
		"entity",
		"event",
		"relationship",
		"integration",
		"signal",
		"config",
		"user-settings",
		"view-settings",
	]),
});

export type BackupPropertyReferenceDeclaration = typeof propertyReferenceDeclarationSchema.Type;

const encodePropertyReferenceDeclarations = Schema.encodeEffect(
	Schema.fromJsonString(Schema.Array(propertyReferenceDeclarationSchema)),
);

export class BackupExportRepository extends Context.Service<BackupExportRepository>()(
	"@ryot-app/kernel-backend/modules/backups/export/repository/BackupExportRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const catalogs = yield* DefinitionCatalog;
			const replacementReminder = alias(schema.reminder, "replacement");
			const assertMetadataBounds = Effect.fn("BackupExportRepository.assertMetadataBounds")(
				function* (userId: UserId, maxBytes: number) {
					const [sizes] = yield* session.run((db) =>
						db.execute<{ manifests: number; installations: number }>(
							sql`
					select
						(select coalesce(sum(octet_length(to_jsonb(revision)::text)), 0)::double precision
						 from ${schema.plugin} as package
						 join ${schema.pluginRevision} as revision on revision.id = package.active_revision_id
							 where package.owner_user_id = ${userId} or (package.owner_user_id is null and package.status = 'active')) as manifests,
						(select coalesce(sum(coalesce(octet_length(config.encrypted_payload), 0) + octet_length(installation.user_settings::text)), 0)::double precision
						 from ${schema.pluginInstallation} as installation
						 left join ${schema.pluginConfigRevision} as config on config.id = installation.active_config_revision_id
						 where installation.user_id = ${userId} and installation.uninstalled_at is null) as installations
				`,
							"objects",
						),
					);
					if (sizes && sizes.manifests > maxBytes) {
						return yield* archiveEntryTooLarge("manifest.json", sizes.manifests, maxBytes);
					}
					if (sizes && sizes.installations > maxBytes) {
						return yield* archiveEntryTooLarge(
							"installations.ndjson",
							sizes.installations,
							maxBytes,
						);
					}
					return yield* Effect.void;
				},
			);
			const inspectRestoreTarget = Effect.fn("BackupExportRepository.inspectRestoreTarget")(
				function* (userId: UserId) {
					const [row] = yield* session.run((db) =>
						db
							.select({
								hasEvents: sql<boolean>`exists (select 1 from ${schema.event} where ${schema.event.userId} = ${userId})`,
								hasPages: sql<boolean>`exists (select 1 from ${pageSchema.page} where ${pageSchema.page.userId} = ${userId})`,
								hasReminders: sql<boolean>`exists (select 1 from ${schema.reminder} where ${schema.reminder.userId} = ${userId})`,
								hasIntegrations: sql<boolean>`exists (select 1 from ${schema.integration} where ${schema.integration.userId} = ${userId})`,
								hasPublications: sql<boolean>`exists (select 1 from ${schema.publication} where ${schema.publication.userId} = ${userId})`,
								hasRelationships: sql<boolean>`exists (select 1 from ${schema.relationship} where ${schema.relationship.userId} = ${userId})`,
								hasManagedAssets: sql<boolean>`exists (select 1 from ${schema.managedAsset} where ${schema.managedAsset.ownerUserId} = ${userId})`,
								hasNotificationChannels: sql<boolean>`exists (select 1 from ${schema.notificationChannel} where ${schema.notificationChannel.userId} = ${userId})`,
								hasCalendarSourceOverrides: sql<boolean>`exists (select 1 from ${schema.calendarSourceOverride} where ${schema.calendarSourceOverride.userId} = ${userId})`,
								hasAssistant: sql<boolean>`exists (select 1 from ${assistantTables.assistantConversation} where ${assistantTables.assistantConversation.userId} = ${userId}) or exists (select 1 from ${assistantTables.assistantProvider} where ${assistantTables.assistantProvider.userId} = ${userId})`,
								hasNonBootstrapEntities: sql<boolean>`
								exists (
									select 1 from ${schema.entity}
									where ${schema.entity.userId} = ${userId}
										and (${schema.entity.providerId} is not null or ${schema.entity.externalId} is not null)
								) or exists (
									select 1 from ${schema.entity}
									where ${schema.entity.userId} = ${userId}
									group by ${schema.entity.entitySchemaPluginId}, ${schema.entity.entitySchemaSlug}
									having count(*) > 1
								)`,
							})
							.from(schema.user)
							.where(eq(schema.user.id, userId)),
					);
					return row;
				},
			);
			const discoverDependencies = Effect.fn("BackupExportRepository.discoverDependencies")(
				function* (
					runId: BackupRunId,
					userId: UserId,
					declarations: ReadonlyArray<BackupPropertyReferenceDeclaration>,
				) {
					yield* session.run((db) =>
						db.execute(sql`
							with referenced_entity(id) as (
								select account_event.entity_id
								from ${schema.event} as account_event
								where account_event.user_id = ${userId}
								union
								select account_event.session_entity_id
								from ${schema.event} as account_event
								where account_event.user_id = ${userId}
									and account_event.session_entity_id is not null
								union
								select account_relationship.source_entity_id
								from ${schema.relationship} as account_relationship
								where account_relationship.user_id = ${userId}
								union
								select account_relationship.target_entity_id
								from ${schema.relationship} as account_relationship
								where account_relationship.user_id = ${userId}
								union
								select account_reminder.entity_id
								from ${schema.reminder} as account_reminder
								where account_reminder.user_id = ${userId}
									and account_reminder.removed_at is null
									and account_reminder.entity_id is not null
								union
								select account_reminder.parent_entity_id
								from ${schema.reminder} as account_reminder
								where account_reminder.user_id = ${userId}
									and account_reminder.removed_at is null
									and account_reminder.parent_entity_id is not null
							)
							insert into ${schema.backupStagingRecord}
								(run_id, namespace, id, section, value)
							select ${runId}, 'entity', target.id, 'entity-dependencies.ndjson', 'null'::jsonb
							from referenced_entity
							inner join ${schema.entity} as target on target.id = referenced_entity.id
							where target.user_id is null
							on conflict do nothing
						`),
					);
					yield* session.run((db) =>
						db.execute(sql`
                        with arguments as (
                            select field.value as definition,
                                coalesce(view.arguments -> field.key, field.value -> 'defaultValue') as value
                            from ${schema.savedView} as view
                            cross join lateral jsonb_each(view.data_sources -> 'parameters' -> 'fields') as field
                            where view.user_id = ${userId}
                        ), saved_reference as (
                            select value #>> '{}' as id from arguments
                            where definition ->> 'type' = 'string'
                                and definition #>> '{reference,kind}' = 'entity-id'
                                and jsonb_typeof(value) = 'string'
                            union
                            select element.value #>> '{}' from arguments
                            cross join lateral jsonb_array_elements(case when jsonb_typeof(arguments.value) = 'array' then arguments.value else '[]'::jsonb end) as element(value)
                            where definition ->> 'type' = 'array'
                                and definition #>> '{items,type}' = 'string'
                                and definition #>> '{items,reference,kind}' = 'entity-id'
                                and jsonb_typeof(element.value) = 'string'
                        )
                        insert into ${schema.backupStagingRecord} (run_id, namespace, id, section, value)
                        select ${runId}, 'entity', target.id, 'entity-dependencies.ndjson', 'null'::jsonb
                        from saved_reference inner join ${schema.entity} as target on target.id = saved_reference.id
                        where target.user_id is null
                        on conflict do nothing
                    `),
					);

					if (declarations.length === 0) {
						return;
					}
					const encodedDeclarations = yield* encodePropertyReferenceDeclarations(declarations).pipe(
						Effect.orDie,
					);
					yield* session.run((db) =>
						db.execute(sql`
							with source_document(
								kind, slug, plugin_id, entity_schema_slug,
								entity_schema_plugin_id, properties
							) as (
								select 'entity', account_entity.entity_schema_slug,
									account_entity.entity_schema_plugin_id, null::text, null::text,
									account_entity.properties
								from ${schema.entity} as account_entity
								where account_entity.user_id = ${userId}
								union all
								select 'event', account_event.event_schema_slug,
									account_event.event_schema_plugin_id, event_entity.entity_schema_slug,
									event_entity.entity_schema_plugin_id, account_event.properties
								from ${schema.event} as account_event
								inner join ${schema.entity} as event_entity
									on event_entity.id = account_event.entity_id
								where account_event.user_id = ${userId}
								union all
								select 'relationship', account_relationship.relationship_schema_slug,
									account_relationship.relationship_schema_plugin_id, null::text, null::text,
									account_relationship.properties
								from ${schema.relationship} as account_relationship
								where account_relationship.user_id = ${userId}
								union all
								select 'integration', account_integration.provider,
									installation.plugin_id, null::text, null::text,
									account_integration.provider_specifics
								from ${schema.integration} as account_integration
								left join ${schema.pluginInstallation} as installation
									on installation.id = account_integration.plugin_installation_id
									and installation.user_id = account_integration.user_id
								where account_integration.user_id = ${userId}
								union all
								select 'signal', subscription.signal_schema_slug,
									subscription.signal_schema_plugin_id, null::text, null::text,
									subscription.metadata
								from ${schema.notificationSubscription} as subscription
								where subscription.user_id = ${userId}
								union all
								select 'user-settings', '', installation.plugin_id,
									null::text, null::text, installation.user_settings
								from ${schema.pluginInstallation} as installation
								where installation.user_id = ${userId}
								union all
								select 'view-settings', view.renderer ->> 'exportName',
									view.renderer ->> 'pluginId', null::text, null::text, view.settings
								from ${schema.savedView} as view
								where view.user_id = ${userId}
									and view.renderer ->> 'kind' = 'plugin'
							), declarations as (
								select encoded_declaration.kind, encoded_declaration.slug,
									encoded_declaration."pluginId" as plugin_id,
									encoded_declaration."entitySchemaSlug" as entity_schema_slug,
									encoded_declaration."entitySchemaPluginId" as entity_schema_plugin_id,
									encoded_declaration.paths
								from jsonb_to_recordset(${encodedDeclarations}::jsonb) as encoded_declaration(
									kind text,
									slug text,
									"pluginId" text,
									"entitySchemaSlug" text,
									"entitySchemaPluginId" text,
									paths jsonb
								)
							), referenced_entity(id) as (
								select distinct target.id
								from source_document
								inner join declarations
									on declarations.kind = source_document.kind
									and declarations.slug = source_document.slug
									and declarations.plugin_id is not distinct from source_document.plugin_id
									and declarations.entity_schema_slug is not distinct from source_document.entity_schema_slug
									and declarations.entity_schema_plugin_id is not distinct from source_document.entity_schema_plugin_id
								cross join lateral jsonb_array_elements_text(declarations.paths) as declared_path(path)
								cross join lateral jsonb_path_query(
									source_document.properties,
									declared_path.path::jsonpath,
									'{}'::jsonb,
									true
								) as reference(value)
								inner join ${schema.entity} as target
									on target.id = (reference.value #>> '{}')
								where target.user_id is null
									and jsonb_typeof(reference.value) = 'string'
							)
							insert into ${schema.backupStagingRecord}
								(run_id, namespace, id, section, value)
							select ${runId}, 'entity', referenced_entity.id,
								'entity-dependencies.ndjson', 'null'::jsonb
							from referenced_entity
							on conflict do nothing
						`),
					);
				},
			);
			const addDependencyIds = Effect.fn("BackupExportRepository.addDependencyIds")(function* (
				runId: BackupRunId,
				ids: ReadonlyArray<string>,
			) {
				if (ids.length === 0) {
					return;
				}
				yield* session.run((db) =>
					db
						.insert(schema.backupStagingRecord)
						.select(
							db
								.select({
									id: schema.entity.id,
									runId: sql<string>`${runId}`.as("run_id"),
									inserted: sql<boolean>`false`.as("inserted"),
									value: sql<unknown>`'null'::jsonb`.as("value"),
									namespace: sql<string>`'entity'`.as("namespace"),
									destinationId: sql<null>`null`.as("destination_id"),
									section: sql<string>`'entity-dependencies.ndjson'`.as("section"),
								})
								.from(schema.entity)
								.where(and(isNull(schema.entity.userId), inArray(schema.entity.id, [...ids]))),
						)
						.onConflictDoNothing(),
				);
			});
			const discoverSnapshotDependencies = Effect.fn(
				"BackupExportRepository.discoverSnapshotDependencies",
			)(function* (
				runId: BackupRunId,
				declarations: ReadonlyArray<BackupPropertyReferenceDeclaration>,
			) {
				const encodedDeclarations = yield* encodePropertyReferenceDeclarations(declarations).pipe(
					Effect.orDie,
				);
				const [row] = yield* session.run((db) =>
					db.execute<{ count: number }>(
						sql`
							with selected as materialized (
								select staging.id
								from ${schema.backupStagingRecord} as staging
								where staging.run_id = ${runId}
									and staging.namespace = 'entity'
									and staging.section = 'entity-dependencies.ndjson'
									and staging.inserted = false
								order by staging.id
								limit 256
							), declarations as (
								select encoded_declaration.kind, encoded_declaration.slug,
									encoded_declaration."pluginId" as plugin_id,
									encoded_declaration."entitySchemaSlug" as entity_schema_slug,
									encoded_declaration."entitySchemaPluginId" as entity_schema_plugin_id,
									encoded_declaration.paths
								from jsonb_to_recordset(${encodedDeclarations}::jsonb) as encoded_declaration(
									kind text,
									slug text,
									"pluginId" text,
									"entitySchemaSlug" text,
									"entitySchemaPluginId" text,
									paths jsonb
								)
							), referenced_entity(id) as (
								select distinct target.id
								from selected
								inner join ${schema.entity} as source_entity
									on source_entity.id = selected.id
								left join ${schema.sandboxProvider} as provider
									on provider.id = source_entity.provider_id
								inner join declarations
									on declarations.kind = 'entity'
									and declarations.slug = source_entity.entity_schema_slug
									and declarations.plugin_id is not distinct from source_entity.entity_schema_plugin_id
								cross join lateral jsonb_array_elements_text(declarations.paths) as declared_path(path)
								cross join lateral jsonb_path_query(
									case
										when (
											source_entity.external_id is not null
											and source_entity.provider_id is null
											and source_entity.entity_schema_plugin_id is not null
										) or provider.root_entity_schema_slug = source_entity.entity_schema_slug
										then '{}'::jsonb
										else source_entity.properties
									end,
									declared_path.path::jsonpath,
									'{}'::jsonb,
									true
								) as reference(value)
								inner join ${schema.entity} as target
									on target.id = (reference.value #>> '{}')
								where source_entity.user_id is null
									and jsonb_typeof(reference.value) = 'string'
									and target.user_id is null
							), inserted_references as (
								insert into ${schema.backupStagingRecord}
									(run_id, namespace, id, section, value)
								select ${runId}, 'entity', referenced_entity.id,
									'entity-dependencies.ndjson', 'null'::jsonb
								from referenced_entity
								on conflict do nothing
								returning id
							), marked_selected as (
								update ${schema.backupStagingRecord} as staging
								set inserted = true
								from selected
								where staging.run_id = ${runId}
									and staging.namespace = 'entity'
									and staging.id = selected.id
								returning staging.id
							)
							select count(*)::int as count from selected
						`,
						"objects",
					),
				);
				return row?.count ?? 0;
			});
			const listSavedViewOverrides = Effect.fn("BackupExportRepository.listSavedViewOverrides")(
				function* (
					userId: UserId,
					page: {
						readonly limit: number;
						readonly after?:
							undefined | { readonly slug: string; readonly pluginId: null | string };
					} = { limit: 256 },
				) {
					const builtins = (yield* catalogs.forUser(userId)).savedViews;
					return yield* session.run((db) =>
						db
							.select()
							.from(schema.savedViewOverride)
							.where(
								and(
									eq(schema.savedViewOverride.userId, userId),
									page.after === undefined
										? undefined
										: sql`(coalesce(${schema.savedViewOverride.pluginId}, ''), ${schema.savedViewOverride.slug}) > (${page.after.pluginId ?? ""}, ${page.after.slug})`,
									builtins.length === 0
										? undefined
										: sql`(coalesce(${schema.savedViewOverride.pluginId}, ''), ${schema.savedViewOverride.slug}) not in (${sql.join(
												builtins.map(
													({ slug, pluginId }) => sql`(${pluginId ?? ""}::text, ${slug}::text)`,
												),
												sql`, `,
											)})`,
								),
							)
							.orderBy(
								asc(sql`coalesce(${schema.savedViewOverride.pluginId}, '')`),
								asc(schema.savedViewOverride.slug),
							)
							.limit(page.limit),
					);
				},
			);
			const listFoldValues = Effect.fn("BackupExportRepository.listFoldValues")(function* (
				userId: UserId,
				page: { readonly limit: number; readonly after: string | undefined },
			) {
				return yield* session.run((db) =>
					db
						.select({
							value: schema.derivedValue.value,
							pluginId: schema.derivedValue.pluginId,
							entityId: schema.derivedValue.subjectEntityId,
						})
						.from(schema.derivedValue)
						.where(
							and(
								eq(schema.derivedValue.userId, userId),
								eq(schema.derivedValue.kind, "subject"),
								exists(
									db
										.select({ id: schema.event.id })
										.from(schema.event)
										.where(
											and(
												eq(schema.event.userId, userId),
												or(
													eq(schema.event.entityId, schema.derivedValue.subjectEntityId),
													eq(schema.event.sessionEntityId, schema.derivedValue.subjectEntityId),
												),
											),
										),
								),
								page.after === undefined
									? undefined
									: gt(schema.derivedValue.subjectEntityId, page.after),
							),
						)
						.orderBy(asc(schema.derivedValue.subjectEntityId))
						.limit(page.limit),
				);
			});

			const listCalendarSourceOverrides = Effect.fn(
				"BackupExportRepository.listCalendarSourceOverrides",
			)(function* (
				userId: UserId,
				page: {
					readonly limit: number;
					readonly after?: undefined | { readonly slug: string; readonly pluginId: string };
				} = { limit: 256 },
			) {
				return yield* session.run((db) =>
					db
						.select()
						.from(schema.calendarSourceOverride)
						.where(
							and(
								eq(schema.calendarSourceOverride.userId, userId),
								page.after === undefined
									? undefined
									: sql`(${schema.calendarSourceOverride.pluginId}, ${schema.calendarSourceOverride.slug}) > (${page.after.pluginId}, ${page.after.slug})`,
							),
						)
						.orderBy(
							asc(schema.calendarSourceOverride.pluginId),
							asc(schema.calendarSourceOverride.slug),
						)
						.limit(page.limit),
				);
			});
			const listReminders = Effect.fn("BackupExportRepository.listReminders")(function* (
				userId: UserId,
				page?: { readonly limit: number; readonly afterId?: string | undefined },
			) {
				return yield* session.run((db) => {
					const query = db
						.select({
							...getTableColumns(schema.reminder),
							replacementId: sql<null | string>`case when ${exists(
								db
									.select({ id: replacementReminder.id })
									.from(replacementReminder)
									.where(
										and(
											eq(replacementReminder.id, schema.reminder.replacementId),
											eq(replacementReminder.userId, userId),
											isNull(replacementReminder.removedAt),
										),
									),
							)} then ${schema.reminder.replacementId} else null end`,
						})
						.from(schema.reminder)
						.where(
							and(
								eq(schema.reminder.userId, userId),
								isNull(schema.reminder.removedAt),
								page?.afterId === undefined ? undefined : gt(schema.reminder.id, page.afterId),
							),
						)
						.orderBy(asc(schema.reminder.id))
						.$dynamic();
					return page === undefined ? query : query.limit(page.limit);
				});
			});
			const listPublications = Effect.fn("BackupExportRepository.listPublications")(function* (
				userId: UserId,
				page: { readonly limit: number; readonly afterId: undefined | PublicationId },
			) {
				return yield* session.run((db) =>
					db
						.select({
							id: schema.publication.id,
							icon: schema.publication.icon,
							title: schema.publication.title,
							snapshot: schema.publication.snapshot,
							createdAt: schema.publication.createdAt,
							definition: schema.publication.definition,
							description: schema.publication.description,
							showOwnerName: schema.publication.showOwnerName,
							pageDefinition: pageSchema.page.publishedDefinition,
						})
						.from(schema.publication)
						.leftJoin(
							pageSchema.page,
							and(
								eq(pageSchema.page.id, schema.publication.pageId),
								eq(pageSchema.page.userId, userId),
							),
						)
						.where(
							and(
								eq(schema.publication.userId, userId),
								isNull(schema.publication.revokedAt),
								page.afterId === undefined ? undefined : gt(schema.publication.id, page.afterId),
							),
						)
						.orderBy(asc(schema.publication.id))
						.limit(page.limit),
				);
			});
			const listReferencedInstallationIds = Effect.fn(
				"BackupExportRepository.listReferencedInstallationIds",
			)(function* (userId: UserId, limit: number = ARCHIVE_LIMITS.maxPluginRecords + 1) {
				const rows = yield* session.run((db) =>
					db
						.select({ id: schema.pluginInstallation.id })
						.from(schema.pluginInstallation)
						.where(
							and(
								eq(schema.pluginInstallation.userId, userId),
								or(
									exists(
										db
											.select({ id: schema.integration.id })
											.from(schema.integration)
											.where(
												and(
													eq(schema.integration.pluginInstallationId, schema.pluginInstallation.id),
													eq(schema.integration.userId, userId),
												),
											),
									),
									exists(
										db
											.select({ id: schema.savedView.id })
											.from(schema.savedView)
											.where(
												and(
													eq(schema.savedView.pluginInstallationId, schema.pluginInstallation.id),
													eq(schema.savedView.userId, userId),
												),
											),
									),
									isNotNull(schema.pluginInstallation.homeSavedView),
								),
							),
						)
						.orderBy(asc(schema.pluginInstallation.id))
						.limit(limit),
				);
				return rows.map(({ id }) => id);
			});
			const listPages = Effect.fn("BackupExportRepository.listPages")(function* (
				userId: UserId,
				afterId?: string,
			) {
				return yield* session.run((db) =>
					db
						.select()
						.from(pageSchema.page)
						.where(
							and(
								eq(pageSchema.page.userId, userId),
								afterId === undefined ? undefined : gt(pageSchema.page.id, afterId),
							),
						)
						.orderBy(asc(pageSchema.page.id))
						.limit(1),
				);
			});
			const findPublicationSources = Effect.fn("BackupExportRepository.findPublicationSources")(
				function* (userId: UserId, sources: readonly EntitySourceReference[]) {
					const collectionIds = sources.flatMap((source) =>
						source.kind === "collection" ? [source.collectionId] : [],
					);
					const customViewIds = sources.flatMap((source) =>
						source.kind === "saved-view" && source.reference.kind === "custom"
							? [source.reference.savedViewId]
							: [],
					);
					const collections = collectionIds.length
						? yield* session.run((db) =>
								db
									.select({ id: schema.entity.id })
									.from(schema.entity)
									.where(
										and(
											eq(schema.entity.userId, userId),
											inArray(schema.entity.id, collectionIds),
											eq(schema.entity.entitySchemaSlug, "collection"),
											isNull(schema.entity.entitySchemaPluginId),
										),
									),
							)
						: [];
					const views = customViewIds.length
						? yield* session.run((db) =>
								db
									.select({ id: schema.savedView.id })
									.from(schema.savedView)
									.where(
										and(
											eq(schema.savedView.userId, userId),
											inArray(schema.savedView.id, customViewIds),
										),
									),
							)
						: [];
					return {
						customViews: new Set(views.map(({ id }) => id)),
						collections: new Set(collections.map(({ id }) => id)),
					};
				},
			);

			const listAssistantConversations = Effect.fn(
				"BackupExportRepository.listAssistantConversations",
			)(function* (userId: UserId, afterId?: string) {
				return yield* session.run((db) =>
					db
						.select()
						.from(assistantTables.assistantConversation)
						.where(
							and(
								eq(assistantTables.assistantConversation.userId, userId),
								afterId === undefined
									? undefined
									: gt(assistantTables.assistantConversation.id, afterId),
							),
						)
						.orderBy(asc(assistantTables.assistantConversation.id))
						.limit(1),
				);
			});
			const listAssistantTurns = Effect.fn("BackupExportRepository.listAssistantTurns")(function* (
				userId: UserId,
				afterId?: string,
			) {
				return yield* session.run((db) =>
					db
						.select()
						.from(assistantTables.assistantTurn)
						.where(
							and(
								eq(assistantTables.assistantTurn.userId, userId),
								afterId === undefined ? undefined : gt(assistantTables.assistantTurn.id, afterId),
							),
						)
						.orderBy(asc(assistantTables.assistantTurn.id))
						.limit(1),
				);
			});
			const listAssistantToolCalls = Effect.fn("BackupExportRepository.listAssistantToolCalls")(
				function* (userId: UserId, afterId?: string) {
					return yield* session.run((db) =>
						db
							.select()
							.from(assistantTables.assistantToolCall)
							.where(
								and(
									eq(assistantTables.assistantToolCall.userId, userId),
									afterId === undefined
										? undefined
										: gt(assistantTables.assistantToolCall.id, afterId),
								),
							)
							.orderBy(asc(assistantTables.assistantToolCall.id))
							.limit(1),
					);
				},
			);
			const listAssistantMessages = Effect.fn("BackupExportRepository.listAssistantMessages")(
				function* (userId: UserId, afterId?: string) {
					return yield* session.run((db) =>
						db
							.select()
							.from(assistantTables.assistantMessage)
							.where(
								and(
									eq(assistantTables.assistantMessage.userId, userId),
									afterId === undefined
										? undefined
										: gt(assistantTables.assistantMessage.id, afterId),
								),
							)
							.orderBy(asc(assistantTables.assistantMessage.id))
							.limit(1),
					);
				},
			);
			const listAssistantOutputs = Effect.fn("BackupExportRepository.listAssistantOutputs")(
				function* (userId: UserId, afterId?: string) {
					return yield* session.run((db) =>
						db
							.select()
							.from(assistantTables.assistantToolOutput)
							.where(
								and(
									eq(assistantTables.assistantToolOutput.userId, userId),
									afterId === undefined
										? undefined
										: gt(assistantTables.assistantToolOutput.id, afterId),
								),
							)
							.orderBy(asc(assistantTables.assistantToolOutput.id))
							.limit(1),
					);
				},
			);
			const readAssistantProvider = Effect.fn("BackupExportRepository.readAssistantProvider")(
				function* (userId: UserId) {
					const [row] = yield* session.run((db) =>
						db
							.select({
								model: assistantTables.assistantProvider.model,
								baseUrl: assistantTables.assistantProvider.baseUrl,
								createdAt: assistantTables.assistantProvider.createdAt,
								updatedAt: assistantTables.assistantProvider.updatedAt,
								contextWindow: assistantTables.assistantProvider.contextWindow,
								maxOutputTokens: assistantTables.assistantProvider.maxOutputTokens,
								hasApiKey: sql<boolean>`${assistantTables.assistantProvider.encryptedApiKey} is not null`,
							})
							.from(assistantTables.assistantProvider)
							.where(eq(assistantTables.assistantProvider.userId, userId)),
					);
					return row;
				},
			);
			return {
				listPages,
				listReminders,
				listFoldValues,
				listPublications,
				addDependencyIds,
				listAssistantTurns,
				assertMetadataBounds,
				inspectRestoreTarget,
				discoverDependencies,
				listAssistantOutputs,
				listAssistantMessages,
				readAssistantProvider,
				listAssistantToolCalls,
				findPublicationSources,
				listSavedViewOverrides,
				listAssistantConversations,
				listCalendarSourceOverrides,
				discoverSnapshotDependencies,
				listReferencedInstallationIds,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(DefinitionCatalog.layer),
	);
}
