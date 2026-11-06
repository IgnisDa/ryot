import { badRequest, DbError } from "@ryot-app/contract/errors";
import type { AutomationRuleMetadata } from "@ryot-app/contract/modules/automations/schemas";
import type {
	IntegrationExtraSettings,
	IntegrationProvider,
	IntegrationProviderSettings,
} from "@ryot-app/contract/modules/integrations/schemas";
import type { IntegrationLot } from "@ryot-app/contract/modules/integrations/types";
import {
	EntityId,
	RelationshipId,
	type SignalSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { UserPreferences } from "@ryot-app/contract/schema/user-preferences";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { Context, Effect, Layer, Schema } from "effect";

import type { PortableUserProfile } from "#modules/accounts/auth/repository";
import { lockEventReferences } from "#modules/events/repository";
import { redactIntegrationForClient } from "#modules/integrations/client-redaction";
import { redactPluginConfig } from "#modules/plugins/configuration/redaction";
import { PluginConfigRevisions } from "#modules/plugins/configuration/revisions";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { upsertSavedViewOverride } from "#modules/saved-views/repository";
import { DatabaseSession } from "#platform/db/session";
import * as backupSchema from "#schema/tables/backups";
import * as schema from "#schema/tables/combined";

type RestoreTranslationInput = Pick<
	typeof schema.entityTranslation.$inferInsert,
	"name" | "entityId" | "language" | "createdAt" | "updatedAt" | "properties" | "populatedAt"
>;

const encodePluginMappings = Schema.encodeEffect(
	Schema.fromJsonString(
		Schema.Array(Schema.Struct({ key: Schema.String, plugin_id: Schema.String })),
	),
);
type RestoreCustomViewInput = {
	readonly userId: UserId;
	readonly pluginInstallationId?: null | string | undefined;
} & Omit<typeof schema.savedView.$inferSelect, "userId" | "revision" | "pluginInstallationId">;
type RestoreRelationshipInput = Pick<
	typeof schema.relationship.$inferInsert,
	| "id"
	| "userId"
	| "createdAt"
	| "properties"
	| "sourceEntityId"
	| "targetEntityId"
	| "relationshipSchemaSlug"
	| "relationshipSchemaPluginId"
>;
type RestoreEntityInput = Pick<
	typeof schema.entity.$inferInsert,
	| "id"
	| "name"
	| "userId"
	| "createdAt"
	| "updatedAt"
	| "properties"
	| "externalId"
	| "providerId"
	| "populatedAt"
	| "entitySchemaSlug"
	| "entitySchemaPluginId"
>;
type RestoreEventInput = Pick<
	typeof schema.event.$inferInsert,
	| "id"
	| "userId"
	| "orderKey"
	| "entityId"
	| "createdAt"
	| "updatedAt"
	| "occurredAt"
	| "properties"
	| "orderCreatedAt"
	| "eventSchemaSlug"
	| "sessionEntityId"
	| "eventSchemaPluginId"
>;
type RestoreInstallationInput = Pick<
	typeof schema.pluginInstallation.$inferSelect,
	"isInitialized"
> &
	Pick<
		typeof schema.pluginInstallation.$inferInsert,
		"userId" | "health" | "pluginId" | "isHidden" | "sortOrder" | "createdAt" | "updatedAt"
	> & {
		readonly id?: string;
		readonly config: Record<string, unknown>;
		readonly preserveExistingConfig: boolean;
		readonly allowMissingRequiredSecrets?: boolean;
		readonly userSettings: Record<string, JsonValue>;
		readonly configuredSecretPaths?: ReadonlyArray<string>;
	};

export class BackupRestorePersistence extends Context.Service<BackupRestorePersistence>()(
	"@ryot-app/kernel-backend/modules/backups/restore/persistence/BackupRestorePersistence",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const configs = yield* PluginConfigRevisions;
			const installations = yield* PluginInstallationRepository;
			const restoreDefaultSubscription = Effect.fn(
				"BackupRestorePersistence.restoreDefaultSubscription",
			)(function* (input: typeof schema.notificationSubscription.$inferInsert) {
				yield* session.requireTransaction;
				yield* session.run((db) =>
					db.insert(schema.notificationSubscription).values(input).onConflictDoNothing(),
				);
			});
			const restoreInstallationHome = Effect.fn("BackupRestorePersistence.restoreInstallationHome")(
				function* (...args: Parameters<typeof installations.setHomeSavedView>) {
					yield* session.requireTransaction;
					return yield* installations.setHomeSavedView(...args);
				},
			);
			const assertBootstrapArchiveUnambiguous = Effect.fn(
				"BackupRestorePersistence.assertBootstrapArchiveUnambiguous",
			)(function* (userId: UserId, runId: string, pluginIdByKey: ReadonlyMap<string, string>) {
				const pluginMappings = yield* encodePluginMappings(
					[...pluginIdByKey].map(([key, pluginId]) => ({ key, plugin_id: pluginId })),
				).pipe(Effect.orDie);
				const rows = yield* session.run((db) =>
					db.execute<{ readonly ambiguous: boolean }>(
						sql`
						with plugin_mappings as (
							select mapping.key, mapping.plugin_id
							from jsonb_to_recordset(${pluginMappings}::jsonb) as mapping(key text, plugin_id text)
						), archived as (
							select
								staging.value ->> 'entitySchemaSlug' as schema_slug,
								staging.value ->> 'entitySchemaPluginKey' as plugin_key,
								count(*)::integer as archive_count
							from ${backupSchema.backupStagingRecord} as staging
							where staging.run_id = ${runId}
								and staging.namespace = 'entity'
								and staging.section = 'entities.ndjson'
								and staging.value -> 'provider' = 'null'::jsonb
								and staging.value ->> 'externalId' is null
							group by staging.value ->> 'entitySchemaSlug', staging.value ->> 'entitySchemaPluginKey'
						)
						select archived.archive_count > 1 as ambiguous
						from archived
						left join plugin_mappings on plugin_mappings.key = archived.plugin_key
						where archived.archive_count > 1
							and exists (
								select 1
								from ${schema.entity} as target
								where target.user_id = ${userId}
									and target.entity_schema_slug = archived.schema_slug
									and target.entity_schema_plugin_id is not distinct from (
										case when archived.plugin_key is null then null else plugin_mappings.plugin_id end
									)
									and target.provider_id is null
									and target.external_id is null
							)
					`,
						"objects",
					),
				);
				if (rows.some(({ ambiguous }) => ambiguous)) {
					return yield* badRequest("Backup bootstrap entity identity is ambiguous");
				}
				return yield* Effect.void;
			});
			const restoreReminder = Effect.fn("BackupRestorePersistence.restoreReminder")(function* (
				input: typeof schema.reminder.$inferInsert,
			) {
				yield* session.requireTransaction;
				yield* session.run((db) => db.insert(schema.reminder).values(input));
			});

			const restoreFoldValue = Effect.fn("BackupRestorePersistence.restoreFoldValue")(
				function* (input: {
					readonly userId: UserId;
					readonly pluginId: string;
					readonly value: JsonValue;
					readonly entityId: EntityId;
					readonly ids: Readonly<Record<string, string>>;
				}) {
					yield* session.requireTransaction;
					yield* session.run((db) =>
						db
							.insert(schema.derivedValue)
							.values({
								kind: "absorbed",
								userId: input.userId,
								pluginRevisionId: "",
								targetId: input.entityId,
								pluginId: input.pluginId,
								subjectEntityId: input.entityId,
								value: { ids: input.ids, value: input.value },
							}),
					);
				},
			);

			const restoreEntity = Effect.fn("BackupRestorePersistence.restoreEntity")(function* (
				input: RestoreEntityInput,
			) {
				const [row] = yield* session.run((db) =>
					db.insert(schema.entity).values(input).returning({ id: schema.entity.id }),
				);
				return row
					? EntityId.make(row.id)
					: yield* new DbError({ message: "Entity restore returned no row" });
			});
			const reserveDependency = Effect.fn("BackupRestorePersistence.reserveDependency")(function* (
				input: RestoreEntityInput,
			) {
				yield* session.requireTransaction;
				const [inserted] = yield* session.run((db) =>
					db
						.insert(schema.entity)
						.values({ ...input, userId: null, properties: {}, populatedAt: null })
						.onConflictDoNothing()
						.returning({ id: schema.entity.id }),
				);
				if (inserted) {
					return { inserted: true, id: EntityId.make(inserted.id) };
				}
				const externalId = input.externalId;
				if (externalId == null) {
					return yield* new DbError({ message: "Snapshot dependency allocation conflicted" });
				}
				const [existing] = yield* session.run((db) =>
					db
						.select({ id: schema.entity.id })
						.from(schema.entity)
						.where(
							and(
								isNull(schema.entity.userId),
								eq(schema.entity.externalId, externalId),
								eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
								input.providerId == null
									? isNull(schema.entity.providerId)
									: eq(schema.entity.providerId, input.providerId),
								input.entitySchemaPluginId == null
									? isNull(schema.entity.entitySchemaPluginId)
									: eq(schema.entity.entitySchemaPluginId, input.entitySchemaPluginId),
							),
						)
						.limit(1),
				);
				return existing
					? { inserted: false, id: EntityId.make(existing.id) }
					: yield* new DbError({ message: "Dependency identity allocation returned no row" });
			});
			const populateDependencySnapshot = Effect.fn(
				"BackupRestorePersistence.populateDependencySnapshot",
			)(function* (input: RestoreEntityInput & { readonly id: string }) {
				yield* session.requireTransaction;
				yield* session.run((db) =>
					db
						.update(schema.entity)
						.set(input)
						.where(and(eq(schema.entity.id, input.id), isNull(schema.entity.userId))),
				);
			});
			const restoreRelationship = Effect.fn("BackupRestorePersistence.restoreRelationship")(
				function* (input: RestoreRelationshipInput) {
					const [row] = yield* session.run((db) =>
						db.insert(schema.relationship).values(input).returning({ id: schema.relationship.id }),
					);
					return row
						? RelationshipId.make(row.id)
						: yield* new DbError({ message: "Relationship restore returned no row" });
				},
			);
			const restoreEvents = Effect.fn("BackupRestorePersistence.restoreEvents")(function* (
				inputs: ReadonlyArray<RestoreEventInput>,
			) {
				if (inputs.length === 0) {
					return;
				}
				yield* lockEventReferences(
					session,
					inputs.map((input) => ({
						userId: input.userId,
						entityId: input.entityId,
						eventSchemaSlug: input.eventSchemaSlug,
						sessionEntityId: input.sessionEntityId,
						eventSchemaPluginId: input.eventSchemaPluginId ?? null,
					})),
				);
				yield* session.run((db) => db.insert(schema.event).values([...inputs]));
			});
			const restoreTranslation = Effect.fn("BackupRestorePersistence.restoreTranslation")(
				function* (input: RestoreTranslationInput) {
					const [row] = yield* session.run((db) =>
						db
							.insert(schema.entityTranslation)
							.values({
								...input,
								sourceContentGeneration: sql`(select ${schema.entity.contentGeneration} from ${schema.entity} where ${schema.entity.id} = ${input.entityId})`,
							})
							.returning({ language: schema.entityTranslation.language }),
					);
					return (
						row?.language ??
						(yield* new DbError({ message: "Translation restore returned no row" }))
					);
				},
			);
			const restorePortableProfile = Effect.fn("BackupRestorePersistence.restorePortableProfile")(
				function* (userId: UserId, profile: PortableUserProfile) {
					const preferences = yield* Schema.decodeEffect(UserPreferences)(profile.preferences).pipe(
						Effect.mapError(
							(error) => new DbError({ message: `Invalid backup preferences: ${error.message}` }),
						),
					);
					const [row] = yield* session.run((db) =>
						db
							.update(schema.user)
							.set({ ...profile, preferences })
							.where(eq(schema.user.id, userId))
							.returning({ id: schema.user.id }),
					);
					return row !== undefined;
				},
			);
			const restoreCustomView = Effect.fn("BackupRestorePersistence.restoreCustomView")(function* (
				input: RestoreCustomViewInput,
			) {
				const [row] = yield* session.run((db) =>
					db.insert(schema.savedView).values(input).returning({ id: schema.savedView.id }),
				);
				return row ?? null;
			});
			const restoreBuiltinOverride = Effect.fn("BackupRestorePersistence.restoreBuiltinOverride")(
				function* (
					input: typeof schema.savedViewOverride.$inferInsert & {
						readonly pluginId: null | string;
					},
				) {
					yield* session.run((db) =>
						upsertSavedViewOverride(db, [input], {
							isHidden: input.isHidden,
							sortOrder: input.sortOrder,
						}),
					);
				},
			);
			const restoreCalendarSourceOverride = Effect.fn(
				"BackupRestorePersistence.restoreCalendarSourceOverride",
			)(function* (input: typeof schema.calendarSourceOverride.$inferInsert) {
				yield* session.run((db) =>
					db
						.insert(schema.calendarSourceOverride)
						.values(input)
						.onConflictDoUpdate({
							set: { isHidden: input.isHidden },
							target: [
								schema.calendarSourceOverride.userId,
								schema.calendarSourceOverride.pluginId,
								schema.calendarSourceOverride.slug,
							],
						}),
				);
			});
			const restoreNotificationSubscription = Effect.fn(
				"BackupRestorePersistence.restoreNotificationSubscription",
			)(function* (input: {
				userId: UserId;
				isActive: boolean;
				signalSchemaSlug: SignalSchemaSlug;
				signalSchemaPluginId: null | string;
				metadata: null | AutomationRuleMetadata;
			}) {
				const [row] = yield* session.run((db) =>
					db
						.update(schema.notificationSubscription)
						.set({
							isActive: input.isActive,
							metadata: input.metadata,
							signalSchemaPluginId: input.signalSchemaPluginId,
						})
						.where(
							and(
								eq(schema.notificationSubscription.userId, input.userId),
								eq(schema.notificationSubscription.signalSchemaSlug, input.signalSchemaSlug),
								input.signalSchemaPluginId === null
									? isNull(schema.notificationSubscription.signalSchemaPluginId)
									: eq(
											schema.notificationSubscription.signalSchemaPluginId,
											input.signalSchemaPluginId,
										),
							),
						)
						.returning({ id: schema.notificationSubscription.id }),
				);
				return row !== undefined;
			});
			const restoreForUser = Effect.fn("BackupRestorePersistence.restoreForUser")(
				function* (input: {
					readonly id: string;
					readonly userId: UserId;
					readonly createdAt: Date;
					readonly updatedAt: Date;
					readonly lot: IntegrationLot;
					readonly name: null | string;
					readonly isDisabled: boolean;
					readonly syncOwnership: boolean;
					readonly minimumProgress: string;
					readonly maximumProgress: string;
					readonly lastFinishedAt: Date | null;
					readonly provider: IntegrationProvider;
					readonly pluginInstallationId: null | string;
					readonly extraSettings: IntegrationExtraSettings;
					readonly providerSpecifics: IntegrationProviderSettings;
				}) {
					if (input.pluginInstallationId === null) {
						yield* session.run((db) =>
							db
								.insert(schema.integration)
								.values({
									...input,
									webhookToken: crypto.randomUUID(),
									clientProviderSpecifics: input.providerSpecifics,
								}),
						);
						return;
					}
					const installationId = input.pluginInstallationId;
					yield* session.run((db) =>
						db
							.select({ id: schema.plugin.id })
							.from(schema.plugin)
							.innerJoin(
								schema.pluginInstallation,
								eq(schema.pluginInstallation.pluginId, schema.plugin.id),
							)
							.where(eq(schema.pluginInstallation.id, installationId))
							.for("share", { of: schema.plugin }),
					);
					const [provider] = yield* session.run((db) =>
						db
							.select({ settingsSchema: schema.definitionIntegrationProvider.settingsSchema })
							.from(schema.pluginInstallation)
							.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginInstallation.pluginId))
							.innerJoin(
								schema.definitionIntegrationProvider,
								and(
									eq(
										schema.definitionIntegrationProvider.pluginRevisionId,
										schema.plugin.activeRevisionId,
									),
									eq(schema.definitionIntegrationProvider.slug, input.provider),
								),
							)
							.where(eq(schema.pluginInstallation.id, installationId))
							.limit(1),
					);
					yield* session.run((db) =>
						db
							.insert(schema.integration)
							.values({
								...input,
								webhookToken: input.lot === "sink" ? crypto.randomUUID() : null,
								clientProviderSpecifics: redactIntegrationForClient(
									provider?.settingsSchema ?? null,
									input.providerSpecifics,
								),
							}),
					);
				},
			);

			const restoreInstallation = Effect.fn("BackupRestorePersistence.restoreInstallation")(
				function* (input: RestoreInstallationInput) {
					yield* configs.lock(input.pluginId);
					yield* session.run((db) =>
						db
							.select({ id: schema.plugin.id })
							.from(schema.plugin)
							.where(and(eq(schema.plugin.id, input.pluginId), isNotNull(schema.plugin.ownerId)))
							.for("share"),
					);
					const {
						config,
						configuredSecretPaths,
						preserveExistingConfig,
						allowMissingRequiredSecrets,
						...values
					} = input;
					const [row] = yield* session.run((db) =>
						db
							.insert(schema.pluginInstallation)
							.values(values)
							.onConflictDoUpdate({
								target: [schema.pluginInstallation.userId, schema.pluginInstallation.pluginId],
								set: {
									healthReason: null,
									homeSavedView: null,
									uninstalledAt: null,
									health: input.health,
									isHidden: input.isHidden,
									sortOrder: input.sortOrder,
									createdAt: input.createdAt,
									updatedAt: input.updatedAt,
									incompatibilityReason: null,
									userSettings: input.userSettings,
									isInitialized: input.isInitialized,
								},
							})
							.returning(),
					);
					if (!row) {
						return undefined;
					}
					const [plugin] = yield* session.run((db) =>
						db.select().from(schema.plugin).where(eq(schema.plugin.id, row.pluginId)).limit(1),
					);
					const pluginRevisionId = plugin?.activeRevisionId;
					if (!plugin || !pluginRevisionId) {
						return yield* new DbError({ message: "Plugin package revision is unavailable" });
					}
					let properties = config;
					let revisionSchema = null;
					const existingConfigRevisionId = row.activeConfigRevisionId;
					if (preserveExistingConfig && existingConfigRevisionId) {
						const hydrated = yield* installations.findByUserAndPlugin(
							UserId.make(row.userId),
							row.pluginId,
						);
						if (!hydrated) {
							return yield* new DbError({
								message: "Invalid installation configuration ownership",
							});
						}
						properties = hydrated.config;
						const [revision] = yield* session.run((db) =>
							db
								.select()
								.from(schema.pluginConfigRevision)
								.where(eq(schema.pluginConfigRevision.id, existingConfigRevisionId))
								.limit(1),
						);
						if (
							!revision ||
							revision.ownerUserId !== row.userId ||
							revision.pluginInstallationId !== row.id
						) {
							return yield* new DbError({
								message: "Invalid installation configuration ownership",
							});
						}
						const [packageRevision] = yield* session.run((db) =>
							db
								.select({ configSchema: schema.pluginRevision.configSchema })
								.from(schema.pluginRevision)
								.where(eq(schema.pluginRevision.id, revision.pluginRevisionId))
								.limit(1),
						);
						revisionSchema = packageRevision?.configSchema ?? null;
					} else if (plugin.ownerId !== null) {
						if (plugin.ownerId !== row.userId) {
							return yield* new DbError({ message: "Invalid installation owner" });
						}
						const revisionInput = {
							pluginRevisionId,
							properties: config,
							ownerUserId: row.userId,
							pluginInstallationId: row.id,
							scope: "installation" as const,
						};
						const activeConfigRevisionId =
							configuredSecretPaths === undefined
								? yield* configs.create(revisionInput)
								: yield* configs.createForRestore({
										...revisionInput,
										configuredSecretPaths,
										allowMissingRequiredSecrets: allowMissingRequiredSecrets ?? false,
									});
						yield* session.run((db) =>
							db
								.update(schema.pluginInstallation)
								.set({ activeConfigRevisionId })
								.where(eq(schema.pluginInstallation.id, row.id)),
						);
						const [revision] = yield* session.run((db) =>
							db
								.select({ configSchema: schema.pluginRevision.configSchema })
								.from(schema.pluginRevision)
								.where(eq(schema.pluginRevision.id, pluginRevisionId))
								.limit(1),
						);
						revisionSchema = revision?.configSchema ?? null;
					} else {
						properties = {};
					}
					const [active] = yield* session.run((db) =>
						db
							.select({ configSchema: schema.pluginRevision.configSchema })
							.from(schema.pluginRevision)
							.where(eq(schema.pluginRevision.id, pluginRevisionId))
							.limit(1),
					);
					const projection =
						plugin.ownerId === null || !active
							? { config: {}, configuredSecrets: [] }
							: redactPluginConfig(active.configSchema, properties, revisionSchema ?? undefined);
					yield* session.run((db) =>
						db
							.update(schema.pluginInstallation)
							.set({
								clientConfig: projection.config,
								configuredSecretPaths: projection.configuredSecrets,
							})
							.where(eq(schema.pluginInstallation.id, row.id)),
					);
					return { id: row.id };
				},
			);
			const activateRestored = Effect.fn("BackupRestorePersistence.activateRestored")(
				function* (input: {
					readonly id: string;
					readonly updatedAt: Date;
					readonly isHidden: boolean;
					readonly healthReason: null | string;
					readonly health: "ready" | "incompatible" | "needs-configuration";
					readonly incompatibilityReason: null | "package-identity-conflict";
				}) {
					const [row] = yield* session.run((db) =>
						db
							.update(schema.pluginInstallation)
							.set({
								health: input.health,
								isHidden: input.isHidden,
								updatedAt: input.updatedAt,
								healthReason: input.healthReason,
								incompatibilityReason: input.incompatibilityReason,
							})
							.where(
								and(
									eq(schema.pluginInstallation.id, input.id),
									eq(schema.pluginInstallation.health, "installing"),
								),
							)
							.returning({ id: schema.pluginInstallation.id }),
					);
					return row !== undefined;
				},
			);
			return {
				restoreEntity,
				restoreEvents,
				restoreForUser,
				restoreReminder,
				restoreFoldValue,
				activateRestored,
				reserveDependency,
				restoreCustomView,
				restoreTranslation,
				restoreInstallation,
				restoreRelationship,
				restoreBuiltinOverride,
				restorePortableProfile,
				restoreInstallationHome,
				restoreDefaultSubscription,
				populateDependencySnapshot,
				restoreCalendarSourceOverride,
				restoreNotificationSubscription,
				assertBootstrapArchiveUnambiguous,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(PluginConfigRevisions.layer),
	);
}
