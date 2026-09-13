import { DbError } from "@ryot-app/contract/errors";
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
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import type { PortableUserProfile } from "#modules/auth/repository";
import { redactIntegrationForClient } from "#modules/integrations/client-redaction";
import { redactPluginConfig } from "#modules/plugins/config-redaction";
import { PluginConfigRevisions } from "#modules/plugins/config-revisions";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";

type RestoreEntityInput = Pick<
	typeof schema.entity.$inferInsert,
	| "id"
	| "name"
	| "userId"
	| "createdAt"
	| "updatedAt"
	| "properties"
	| "externalId"
	| "populatedAt"
	| "providerId"
	| "entitySchemaPluginId"
	| "entitySchemaSlug"
>;
type RestoreRelationshipInput = Pick<
	typeof schema.relationship.$inferInsert,
	| "id"
	| "userId"
	| "createdAt"
	| "properties"
	| "sourceEntityId"
	| "targetEntityId"
	| "relationshipSchemaPluginId"
	| "relationshipSchemaSlug"
>;
type RestoreEventInput = Pick<
	typeof schema.event.$inferInsert,
	| "id"
	| "userId"
	| "entityId"
	| "createdAt"
	| "updatedAt"
	| "occurredAt"
	| "properties"
	| "eventSchemaPluginId"
	| "eventSchemaSlug"
	| "sessionEntityId"
>;
type RestoreTranslationInput = Pick<
	typeof schema.entityTranslation.$inferInsert,
	"name" | "entityId" | "language" | "properties" | "populatedAt" | "createdAt" | "updatedAt"
>;
type RestoreCustomViewInput = Omit<
	typeof schema.savedView.$inferSelect,
	"userId" | "revision" | "pluginInstallationId"
> & { readonly userId: UserId; readonly pluginInstallationId?: string | null | undefined };
type RestoreInstallationInput = Pick<
	typeof schema.pluginInstallation.$inferInsert,
	"userId" | "pluginId" | "sortOrder" | "health" | "isHidden" | "createdAt" | "updatedAt"
> & {
	readonly id?: string;
	readonly config: Record<string, unknown>;
	readonly preserveExistingConfig: boolean;
	readonly allowMissingRequiredSecrets?: boolean;
	readonly userSettings: Record<string, JsonValue>;
	readonly configuredSecretPaths?: ReadonlyArray<string>;
};

export class BackupRestorePersistence extends Context.Service<BackupRestorePersistence>()(
	"BackupRestorePersistence",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const configs = yield* PluginConfigRevisions;
			const installations = yield* PluginInstallationRepository;
			const savedViews = yield* SavedViewsRepository;

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
				yield* session.run((db) => db.insert(schema.event).values([...inputs]));
			});
			const restoreTranslation = Effect.fn("BackupRestorePersistence.restoreTranslation")(
				function* (input: RestoreTranslationInput) {
					const [row] = yield* session.run((db) =>
						db
							.insert(schema.entityTranslation)
							.values(input)
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
					const [row] = yield* session.run((db) =>
						db
							.update(schema.user)
							.set(profile)
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
					db.insert(schema.savedView).values(input).returning({ slug: schema.savedView.slug }),
				);
				return row ? yield* savedViews.findBySlug(input.userId, row.slug) : null;
			});
			const restoreNotificationSubscription = Effect.fn(
				"BackupRestorePersistence.restoreNotificationSubscription",
			)(function* (input: {
				userId: UserId;
				isActive: boolean;
				signalSchemaSlug: SignalSchemaSlug;
				signalSchemaPluginId: string | null;
				metadata: AutomationRuleMetadata | null;
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
					readonly name: string | null;
					readonly isDisabled: boolean;
					readonly syncOwnership: boolean;
					readonly minimumProgress: string;
					readonly maximumProgress: string;
					readonly lastFinishedAt: Date | null;
					readonly provider: IntegrationProvider;
					readonly pluginInstallationId: string | null;
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
									uninstalledAt: null,
									health: input.health,
									isHidden: input.isHidden,
									sortOrder: input.sortOrder,
									createdAt: input.createdAt,
									updatedAt: input.updatedAt,
									userSettings: input.userSettings,
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
								.select({ manifest: schema.pluginRevision.manifest })
								.from(schema.pluginRevision)
								.where(eq(schema.pluginRevision.id, revision.pluginRevisionId))
								.limit(1),
						);
						revisionSchema = packageRevision?.manifest.configSchema ?? null;
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
								.select({ manifest: schema.pluginRevision.manifest })
								.from(schema.pluginRevision)
								.where(eq(schema.pluginRevision.id, pluginRevisionId))
								.limit(1),
						);
						revisionSchema = revision?.manifest.configSchema ?? null;
					} else {
						properties = {};
					}
					const [active] = yield* session.run((db) =>
						db
							.select({ manifest: schema.pluginRevision.manifest })
							.from(schema.pluginRevision)
							.where(eq(schema.pluginRevision.id, pluginRevisionId))
							.limit(1),
					);
					const projection =
						plugin.ownerId === null || !active
							? { config: {}, configuredSecrets: [] }
							: redactPluginConfig(
									active.manifest.configSchema,
									properties,
									revisionSchema ?? undefined,
								);
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
					readonly health: "ready" | "needs-configuration";
				}) {
					const [row] = yield* session.run((db) =>
						db
							.update(schema.pluginInstallation)
							.set({
								healthReason: null,
								health: input.health,
								isHidden: input.isHidden,
								updatedAt: input.updatedAt,
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
				activateRestored,
				restoreCustomView,
				restoreTranslation,
				restoreInstallation,
				restoreRelationship,
				restorePortableProfile,
				restoreNotificationSubscription,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(PluginConfigRevisions.layer),
	);
}
