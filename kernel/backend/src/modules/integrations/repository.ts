import { DbError } from "@ryot-app/contract/errors";
import type {
	IntegrationExtraSettings,
	IntegrationProvider,
	IntegrationProviderSettings,
	IntegrationSnapshot,
} from "@ryot-app/contract/modules/integrations/schemas";
import type { IntegrationLot } from "@ryot-app/contract/modules/integrations/types";
import {
	IntegrationId,
	IntegrationWebhookToken,
	UserId,
	type ImportRunId,
} from "@ryot-app/contract/schema/brands";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { AuthRepository } from "#modules/auth/repository";
import { ImportsRepository } from "#modules/imports/repository";
import { PluginRevisionActivation } from "#modules/plugins/revision-activation";

import { redactIntegrationForClient } from "./client-redaction";
import { integrationHealthExcludedFailureCodes } from "./health";

type IntegrationRow = Omit<
	typeof schema.integration.$inferSelect,
	"clientProviderSpecifics" | "retiring"
>;
type SelectedIntegrationRow = IntegrationRow & { readonly pluginSlug: string | null };

export type IntegrationRecord = IntegrationSnapshot & {
	readonly userId: UserId;
	readonly pluginInstallationId: string | null;
};

const integrationSelection = {
	id: schema.integration.id,
	lot: schema.integration.lot,
	name: schema.integration.name,
	userId: schema.integration.userId,
	provider: schema.integration.provider,
	createdAt: schema.integration.createdAt,
	updatedAt: schema.integration.updatedAt,
	isDisabled: schema.integration.isDisabled,
	webhookToken: schema.integration.webhookToken,
	extraSettings: schema.integration.extraSettings,
	syncOwnership: schema.integration.syncOwnership,
	lastFinishedAt: schema.integration.lastFinishedAt,
	minimumProgress: schema.integration.minimumProgress,
	maximumProgress: schema.integration.maximumProgress,
	providerSpecifics: schema.integration.providerSpecifics,
	pluginInstallationId: schema.integration.pluginInstallationId,
	pluginSlug: sql<string | null>`(
		select ${schema.plugin.slug}
		from ${schema.pluginInstallation}
		inner join ${schema.plugin} on ${schema.plugin.id} = ${schema.pluginInstallation.pluginId}
		where ${schema.pluginInstallation.id} = ${schema.integration.pluginInstallationId}
	)`,
};

const { webhookToken: _webhookToken, ...integrationBackupSelection } = integrationSelection;

const clientIntegrationSelection = {
	...integrationSelection,
	providerSpecifics: schema.integration.clientProviderSpecifics,
};

const providerSettingsSchema = schema.definitionIntegrationProvider.settingsSchema;

const activeProviderDefinition = (
	provider: IntegrationProvider | typeof schema.integration.provider,
) =>
	and(
		eq(schema.definitionIntegrationProvider.pluginRevisionId, schema.plugin.activeRevisionId),
		eq(schema.definitionIntegrationProvider.slug, provider),
	);

const normalizeIntegration = (row: SelectedIntegrationRow): IntegrationRecord => {
	if (row.lot === "sink" && row.webhookToken === null) {
		throw new Error(`Sink integration '${row.id}' has no webhook token`);
	}
	return {
		lot: row.lot,
		name: row.name,
		provider: row.provider,
		pluginSlug: row.pluginSlug,
		isDisabled: row.isDisabled,
		id: IntegrationId.make(row.id),
		userId: UserId.make(row.userId),
		syncOwnership: row.syncOwnership,
		extraSettings: row.extraSettings,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		providerSpecifics: row.providerSpecifics,
		pluginInstallationId: row.pluginInstallationId,
		minimumProgress: Number.parseFloat(row.minimumProgress),
		maximumProgress: Number.parseFloat(row.maximumProgress),
		lastFinishedAt: row.lastFinishedAt?.toISOString() ?? null,
	};
};

const webhookTokenForLot = (lot: IntegrationLot) =>
	lot === "sink" ? IntegrationWebhookToken.make(crypto.randomUUID()) : null;

const ownedIntegrationWhere = (input: { integrationId: IntegrationId; userId: UserId }) =>
	and(eq(schema.integration.id, input.integrationId), eq(schema.integration.userId, input.userId));

export class IntegrationsRepository extends Context.Service<IntegrationsRepository>()(
	"IntegrationsRepository",
	{
		make: Effect.gen(function* () {
			const database = yield* DatabaseSession;
			const auth = yield* AuthRepository;
			const imports = yield* ImportsRepository.make;
			const hasAnyForUser = Effect.fn("IntegrationsRepository.hasAnyForUser")(function* (
				userId: UserId,
			) {
				const [row] = yield* database.run((db) =>
					db
						.select({ id: schema.integration.id })
						.from(schema.integration)
						.where(eq(schema.integration.userId, userId))
						.limit(1),
				);
				return row !== undefined;
			});

			const lockInstallationPlugin = Effect.fn(function* (pluginInstallationId: string | null) {
				if (pluginInstallationId === null) {
					return;
				}
				yield* database.run((db) =>
					db
						.select({ id: schema.plugin.id })
						.from(schema.plugin)
						.innerJoin(
							schema.pluginInstallation,
							eq(schema.pluginInstallation.pluginId, schema.plugin.id),
						)
						.where(eq(schema.pluginInstallation.id, pluginInstallationId))
						.for("share", { of: schema.plugin }),
				);
			});

			const clientProviderSpecifics = Effect.fn(function* (input: {
				pluginInstallationId: string | null;
				provider: IntegrationProvider;
				providerSpecifics: IntegrationProviderSettings;
			}) {
				if (input.pluginInstallationId === null) {
					return input.providerSpecifics;
				}
				const installationId = input.pluginInstallationId;
				const [row] = yield* database.run((db) =>
					db
						.select({ settingsSchema: providerSettingsSchema })
						.from(schema.pluginInstallation)
						.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginInstallation.pluginId))
						.innerJoin(
							schema.definitionIntegrationProvider,
							activeProviderDefinition(input.provider),
						)
						.where(eq(schema.pluginInstallation.id, installationId))
						.limit(1),
				);
				return redactIntegrationForClient(row?.settingsSchema ?? null, input.providerSpecifics);
			});

			const refreshClientProviderSpecificsForPlugin = Effect.fn(
				"IntegrationsRepository.refreshClientProviderSpecificsForPlugin",
			)(function* (pluginId: string) {
				yield* database.run((db) =>
					db
						.select({ id: schema.plugin.id })
						.from(schema.plugin)
						.where(eq(schema.plugin.id, pluginId))
						.for("share"),
				);
				const locked = yield* database.run((db) =>
					db
						.select({ id: schema.integration.id })
						.from(schema.integration)
						.innerJoin(
							schema.pluginInstallation,
							eq(schema.pluginInstallation.id, schema.integration.pluginInstallationId),
						)
						.where(eq(schema.pluginInstallation.pluginId, pluginId))
						.orderBy(asc(schema.integration.id))
						.for("update", { of: schema.integration }),
				);
				if (locked.length === 0) {
					return;
				}
				const rows = yield* database.run((db) =>
					db
						.select({
							id: schema.integration.id,
							settingsSchema: providerSettingsSchema,
							providerSpecifics: schema.integration.providerSpecifics,
						})
						.from(schema.integration)
						.innerJoin(
							schema.pluginInstallation,
							eq(schema.pluginInstallation.id, schema.integration.pluginInstallationId),
						)
						.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginInstallation.pluginId))
						.leftJoin(
							schema.definitionIntegrationProvider,
							activeProviderDefinition(schema.integration.provider),
						)
						.where(
							inArray(
								schema.integration.id,
								locked.map(({ id }) => id),
							),
						),
				);
				yield* Effect.forEach(
					rows,
					(row) =>
						database.run((db) =>
							db
								.update(schema.integration)
								.set({
									clientProviderSpecifics: redactIntegrationForClient(
										row.settingsSchema,
										row.providerSpecifics,
									),
								})
								.where(eq(schema.integration.id, row.id)),
						),
					{ discard: true },
				);
			});

			const createForUser = Effect.fn("IntegrationsRepository.createForUser")(function* (input: {
				userId: UserId;
				lot: IntegrationLot;
				isDisabled: boolean;
				name?: string | null;
				syncOwnership: boolean;
				minimumProgress: string;
				maximumProgress: string;
				pluginInstallationId: string | null;
				provider: IntegrationProvider;
				extraSettings: IntegrationExtraSettings;
				providerSpecifics: IntegrationProviderSettings;
			}) {
				yield* lockInstallationPlugin(input.pluginInstallationId);
				yield* database.acquireUserWriteLock(input.userId);
				const installationId = input.pluginInstallationId;
				if (installationId !== null) {
					const [installation] = yield* database.run((db) =>
						db
							.select({ retiring: schema.pluginInstallation.ingestionRetiring })
							.from(schema.pluginInstallation)
							.where(
								and(
									eq(schema.pluginInstallation.id, installationId),
									eq(schema.pluginInstallation.userId, input.userId),
								),
							)
							.limit(1),
					);
					if (!installation || installation.retiring) {
						return yield* new DbError({ message: "Integration installation has retired" });
					}
				}
				const clientSpecifics = yield* clientProviderSpecifics(input);
				const [row] = yield* database.run((db) =>
					db
						.insert(schema.integration)
						.values({
							lot: input.lot,
							userId: input.userId,
							name: input.name ?? null,
							provider: input.provider,
							isDisabled: input.isDisabled,
							extraSettings: input.extraSettings,
							syncOwnership: input.syncOwnership,
							minimumProgress: input.minimumProgress,
							maximumProgress: input.maximumProgress,
							clientProviderSpecifics: clientSpecifics,
							providerSpecifics: input.providerSpecifics,
							webhookToken: webhookTokenForLot(input.lot),
							pluginInstallationId: input.pluginInstallationId,
						})
						.returning({ id: schema.integration.id }),
				);
				if (!row) {
					return yield* Effect.die("Integration row missing after insert");
				}
				return { id: IntegrationId.make(row.id) };
			});

			const getByIdAnyUser = Effect.fn("IntegrationsRepository.getByIdAnyUser")(function* (input: {
				integrationId: IntegrationId;
			}) {
				const [row] = yield* database.run((db) =>
					db
						.select(integrationSelection)
						.from(schema.integration)
						.where(eq(schema.integration.id, input.integrationId))
						.limit(1),
				);

				return row ? normalizeIntegration(row) : null;
			});

			const getByWebhookToken = Effect.fn("IntegrationsRepository.getByWebhookToken")(function* (
				webhookToken: IntegrationWebhookToken,
			) {
				const [row] = yield* database.run((db) =>
					db
						.select(integrationSelection)
						.from(schema.integration)
						.where(
							and(
								eq(schema.integration.webhookToken, webhookToken),
								eq(schema.integration.lot, "sink"),
								eq(schema.integration.retiring, false),
							),
						)
						.limit(1),
				);

				return row ? normalizeIntegration(row) : null;
			});

			const getForUser = Effect.fn("IntegrationsRepository.getForUser")(function* (input: {
				userId: UserId;
				integrationId: IntegrationId;
			}) {
				const [row] = yield* database.run((db) =>
					db
						.select(integrationSelection)
						.from(schema.integration)
						.where(ownedIntegrationWhere(input))
						.limit(1),
				);

				return row ? normalizeIntegration(row) : null;
			});

			const getClientForUser = Effect.fn("IntegrationsRepository.getClientForUser")(
				function* (input: { userId: UserId; integrationId: IntegrationId }) {
					const [row] = yield* database.run((db) =>
						db
							.select(clientIntegrationSelection)
							.from(schema.integration)
							.where(ownedIntegrationWhere(input))
							.limit(1),
					);

					return row ? normalizeIntegration(row) : null;
				},
			);

			const getUserDisableIntegrations = Effect.fn(
				"IntegrationsRepository.getUserDisableIntegrations",
			)(function* (input: { userId: UserId }) {
				return (yield* auth.getUserPreferences(input.userId))?.disableIntegrations === true;
			});

			const listEnabledYankIntegrations = Effect.fn(
				"IntegrationsRepository.listEnabledYankIntegrations",
			)(function* (input: { userId: UserId | null }) {
				const conditions = [
					eq(schema.integration.lot, "yank"),
					eq(schema.integration.isDisabled, false),
					eq(schema.integration.retiring, false),
				];
				if (input.userId !== null) {
					conditions.push(eq(schema.integration.userId, input.userId));
				}
				const rows = yield* database.run((db) =>
					db
						.select(integrationSelection)
						.from(schema.integration)
						.where(and(...conditions))
						.orderBy(desc(schema.integration.createdAt)),
				);

				return rows.map((row) => normalizeIntegration(row));
			});

			const listForUser = Effect.fn("IntegrationsRepository.listForUser")(function* (input: {
				userId: UserId;
				isDisabled?: boolean | undefined;
				provider?: IntegrationProvider | undefined;
			}) {
				const conditions = [eq(schema.integration.userId, input.userId)];
				if (input.provider !== undefined) {
					conditions.push(eq(schema.integration.provider, input.provider));
				}
				if (input.isDisabled !== undefined) {
					conditions.push(eq(schema.integration.isDisabled, input.isDisabled));
				}

				const rows = yield* database.run((db) =>
					db
						.select(integrationSelection)
						.from(schema.integration)
						.where(and(...conditions))
						.orderBy(desc(schema.integration.createdAt)),
				);

				return rows.map((row) => normalizeIntegration(row));
			});

			const listForBackup = Effect.fn("IntegrationsRepository.listForBackup")(function* (
				userId: UserId,
			) {
				return yield* database.run((db) =>
					db
						.select(integrationBackupSelection)
						.from(schema.integration)
						.where(eq(schema.integration.userId, userId))
						.orderBy(asc(schema.integration.id)),
				);
			});

			const updateForUser = Effect.fn("IntegrationsRepository.updateForUser")(function* (input: {
				userId: UserId;
				integrationId: IntegrationId;
				name?: string | null | undefined;
				isDisabled?: boolean | undefined;
				syncOwnership?: boolean | undefined;
				minimumProgress?: string | undefined;
				maximumProgress?: string | undefined;
				lastFinishedAt?: Date | null | undefined;
				extraSettings?: IntegrationExtraSettings | undefined;
				providerSpecifics?: IntegrationProviderSettings | undefined;
			}) {
				type UpdateSet = Partial<typeof schema.integration.$inferInsert>;
				const updates: UpdateSet = {};
				if (input.name !== undefined) {
					updates.name = input.name;
				}
				if (input.isDisabled !== undefined) {
					updates.isDisabled = input.isDisabled;
				}
				if (input.syncOwnership !== undefined) {
					updates.syncOwnership = input.syncOwnership;
				}
				if (input.minimumProgress !== undefined) {
					updates.minimumProgress = input.minimumProgress;
				}
				if (input.maximumProgress !== undefined) {
					updates.maximumProgress = input.maximumProgress;
				}
				if (input.lastFinishedAt !== undefined) {
					updates.lastFinishedAt = input.lastFinishedAt;
				}
				if (input.extraSettings !== undefined) {
					updates.extraSettings = input.extraSettings;
				}
				if (input.providerSpecifics !== undefined) {
					const [existing] = yield* database.run((db) =>
						db
							.select({
								provider: schema.integration.provider,
								pluginInstallationId: schema.integration.pluginInstallationId,
							})
							.from(schema.integration)
							.where(ownedIntegrationWhere(input))
							.limit(1),
					);
					if (!existing) {
						return null;
					}
					yield* lockInstallationPlugin(existing.pluginInstallationId);
					yield* database.run((db) =>
						db
							.select({ id: schema.integration.id })
							.from(schema.integration)
							.where(ownedIntegrationWhere(input))
							.for("update"),
					);
					updates.providerSpecifics = input.providerSpecifics;
					updates.clientProviderSpecifics = yield* clientProviderSpecifics({
						...existing,
						providerSpecifics: input.providerSpecifics,
					});
				}

				if (Object.keys(updates).length === 0) {
					const [row] = yield* database.run((db) =>
						db
							.select({ id: schema.integration.id })
							.from(schema.integration)
							.where(ownedIntegrationWhere(input))
							.limit(1),
					);
					return row ? { id: IntegrationId.make(row.id) } : null;
				}

				const [row] = yield* database.run((db) =>
					db
						.update(schema.integration)
						.set(updates)
						.where(ownedIntegrationWhere(input))
						.returning({ id: schema.integration.id }),
				);

				return row ? { id: IntegrationId.make(row.id) } : null;
			});

			const disableForUserIfEnabled = Effect.fn("IntegrationsRepository.disableForUserIfEnabled")(
				function* (input: { userId: UserId; integrationId: IntegrationId }) {
					const [row] = yield* database.run((db) =>
						db
							.update(schema.integration)
							.set({ isDisabled: true })
							.where(and(ownedIntegrationWhere(input), eq(schema.integration.isDisabled, false)))
							.returning({ id: schema.integration.id }),
					);
					return row !== undefined;
				},
			);

			const recordRunFinished = Effect.fn("IntegrationsRepository.recordRunFinished")(
				function* (input: { userId: UserId; integrationId: IntegrationId; finishedAt: Date }) {
					yield* database.run((db) =>
						db
							.update(schema.integration)
							.set({ lastFinishedAt: input.finishedAt })
							.where(
								and(
									ownedIntegrationWhere(input),
									sql`${schema.integration.lastFinishedAt} is null or ${schema.integration.lastFinishedAt} < ${input.finishedAt}`,
								),
							),
					);
				},
			);

			const listRecentHealthStatuses = Effect.fn("IntegrationsRepository.listRecentHealthStatuses")(
				function* (input: { userId: UserId; integrationId: IntegrationId }) {
					return yield* database.run((db) =>
						db
							.select({ status: schema.importRun.status })
							.from(schema.importRun)
							.where(
								and(
									eq(schema.importRun.userId, input.userId),
									eq(schema.importRun.integrationId, input.integrationId),
									inArray(schema.importRun.status, ["completed", "failed", "cancelled"]),
									sql`coalesce(${schema.importRun.failureReason} ->> 'code', '') not in (${sql.join(
										integrationHealthExcludedFailureCodes.map((code) => sql`${code}`),
										sql`, `,
									)})`,
								),
							)
							.orderBy(desc(schema.importRun.createdAt), desc(schema.importRun.id))
							.limit(5),
					);
				},
			);

			const hasAutoDisableClaim = Effect.fn("IntegrationsRepository.hasAutoDisableClaim")(
				function* (importRunId: ImportRunId) {
					const [row] = yield* database.run((db) =>
						db
							.select({ importRunId: schema.integrationAutoDisableClaim.importRunId })
							.from(schema.integrationAutoDisableClaim)
							.where(eq(schema.integrationAutoDisableClaim.importRunId, importRunId))
							.limit(1),
					);
					return row !== undefined;
				},
			);

			const insertAutoDisableClaim = Effect.fn("IntegrationsRepository.insertAutoDisableClaim")(
				function* (input: { importRunId: ImportRunId; integrationId: IntegrationId }) {
					yield* database.run((db) =>
						db.insert(schema.integrationAutoDisableClaim).values(input).onConflictDoNothing(),
					);
				},
			);

			const deleteForUser = Effect.fn("IntegrationsRepository.deleteForUser")(function* (input: {
				userId: UserId;
				integrationId: IntegrationId;
			}) {
				return yield* database
					.transaction(
						Effect.gen(function* () {
							yield* database.acquireUserWriteLock(input.userId);
							yield* imports.purgePayloadReservations(input);
							const rows = yield* database.run((db) =>
								db
									.delete(schema.integration)
									.where(
										and(
											ownedIntegrationWhere(input),
											eq(schema.integration.retiring, true),
											sql`not exists (select 1 from ${schema.importRun} where ${schema.importRun.integrationId} = ${input.integrationId} and (${schema.importRun.status} in ('pending', 'blocked', 'running', 'cancelling') or ${schema.importRun.pins} is not null or exists (select 1 from ${schema.importPayloadReservation} where ${schema.importPayloadReservation.runId} = ${schema.importRun.id} and not ${schema.importPayloadReservation.released})))`,
										),
									)
									.returning({ id: schema.integration.id }),
							);
							if (rows.length === 0 && (yield* getForUser(input))) {
								return yield* new DbError({
									message: "Integration retirement cleanup is incomplete",
								});
							}
							return yield* Effect.void;
						}),
					)
					.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
			});
			const beginRetirement = Effect.fn("IntegrationsRepository.beginRetirement")(
				function* (input: { userId: UserId; integrationId: IntegrationId }) {
					yield* database.requireTransaction;
					yield* database.acquireUserWriteLock(input.userId);
					const rows = yield* database.run((db) =>
						db
							.update(schema.integration)
							.set({ retiring: true })
							.where(ownedIntegrationWhere(input))
							.returning({ id: schema.integration.id }),
					);
					return rows.length > 0;
				},
			);

			return {
				getForUser,
				listForUser,
				listForBackup,
				createForUser,
				hasAnyForUser,
				updateForUser,
				deleteForUser,
				getByIdAnyUser,
				beginRetirement,
				getClientForUser,
				getByWebhookToken,
				recordRunFinished,
				hasAutoDisableClaim,
				insertAutoDisableClaim,
				disableForUserIfEnabled,
				listRecentHealthStatuses,
				getUserDisableIntegrations,
				listEnabledYankIntegrations,
				refreshClientProviderSpecificsForPlugin,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(AuthRepository.layer));
}

export const IntegrationPluginRevisionActivationLive = Layer.effect(
	PluginRevisionActivation,
	Effect.map(IntegrationsRepository, (repository) => ({
		activated: repository.refreshClientProviderSpecificsForPlugin,
	})),
);
