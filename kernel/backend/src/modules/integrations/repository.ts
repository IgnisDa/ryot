import type {
	IntegrationExtraSettings,
	IntegrationProvider,
	IntegrationProviderSettings,
	ListedIntegration,
} from "@ryot-app/contract/modules/integrations/schemas";
import type { IntegrationLot } from "@ryot-app/contract/modules/integrations/types";
import type { ImportRunId } from "@ryot-app/contract/schema/brands";
import { IntegrationId, IntegrationWebhookToken, UserId } from "@ryot-app/contract/schema/brands";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { user } from "#lib/infrastructure/db/schema/tables/auth";
import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

type IntegrationRow = typeof schema.integration.$inferSelect;
type SelectedIntegrationRow = IntegrationRow & { readonly pluginSlug: string };

export type IntegrationRecord = ListedIntegration & {
	readonly userId: UserId;
	readonly pluginInstallationId: string;
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
	pluginSlug: sql<string>`(
		select ${schema.plugin.slug}
		from ${schema.pluginInstallation}
		inner join ${schema.plugin} on ${schema.plugin.id} = ${schema.pluginInstallation.pluginId}
		where ${schema.pluginInstallation.id} = ${schema.integration.pluginInstallationId}
	)`,
};

const { webhookToken: _webhookToken, ...integrationBackupSelection } = integrationSelection;

const normalizeIntegration = (
	frontendUrl: string,
	row: SelectedIntegrationRow,
): IntegrationRecord => {
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
		...(row.webhookToken === null ? {} : { webhookUrl: `${frontendUrl}/_i/${row.webhookToken}` }),
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
			const { frontendUrl } = yield* AppConfig;
			const hasAnyForUser = Effect.fn("IntegrationsRepository.hasAnyForUser")(function* (
				userId: UserId,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select({ id: schema.integration.id })
						.from(schema.integration)
						.where(eq(schema.integration.userId, userId))
						.limit(1),
				);
				return row !== undefined;
			});

			const createForUser = Effect.fn("IntegrationsRepository.createForUser")(function* (input: {
				userId: UserId;
				lot: IntegrationLot;
				isDisabled: boolean;
				name?: string | null;
				syncOwnership: boolean;
				minimumProgress: string;
				maximumProgress: string;
				pluginInstallationId: string;
				provider: IntegrationProvider;
				extraSettings: IntegrationExtraSettings;
				providerSpecifics: IntegrationProviderSettings;
			}) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
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
							providerSpecifics: input.providerSpecifics,
							webhookToken: webhookTokenForLot(input.lot),
							pluginInstallationId: input.pluginInstallationId,
						})
						.returning(integrationSelection),
				);
				if (!row) {
					return yield* Effect.die("Integration row missing after insert");
				}
				return normalizeIntegration(frontendUrl, row);
			});

			const getByIdAnyUser = Effect.fn("IntegrationsRepository.getByIdAnyUser")(function* (input: {
				integrationId: IntegrationId;
			}) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select(integrationSelection)
						.from(schema.integration)
						.where(eq(schema.integration.id, input.integrationId))
						.limit(1),
				);

				return row ? normalizeIntegration(frontendUrl, row) : null;
			});

			const getByWebhookToken = Effect.fn("IntegrationsRepository.getByWebhookToken")(function* (
				webhookToken: IntegrationWebhookToken,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select(integrationSelection)
						.from(schema.integration)
						.where(
							and(
								eq(schema.integration.webhookToken, webhookToken),
								eq(schema.integration.lot, "sink"),
							),
						)
						.limit(1),
				);

				return row ? normalizeIntegration(frontendUrl, row) : null;
			});

			const getForUser = Effect.fn("IntegrationsRepository.getForUser")(function* (input: {
				userId: UserId;
				integrationId: IntegrationId;
			}) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select(integrationSelection)
						.from(schema.integration)
						.where(ownedIntegrationWhere(input))
						.limit(1),
				);

				return row ? normalizeIntegration(frontendUrl, row) : null;
			});

			const getUserDisableIntegrations = Effect.fn(
				"IntegrationsRepository.getUserDisableIntegrations",
			)(function* (input: { userId: UserId }) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select({ preferences: user.preferences })
						.from(user)
						.where(eq(user.id, input.userId))
						.limit(1),
				);
				const preferences = row?.preferences as { disableIntegrations?: boolean } | undefined;
				return preferences?.disableIntegrations === true;
			});

			const listEnabledYankIntegrations = Effect.fn(
				"IntegrationsRepository.listEnabledYankIntegrations",
			)(function* (input: { userId: UserId | null }) {
				const db = yield* Database;
				const conditions = [
					eq(schema.integration.lot, "yank"),
					eq(schema.integration.isDisabled, false),
				];
				if (input.userId !== null) {
					conditions.push(eq(schema.integration.userId, input.userId));
				}
				const rows = yield* mapDatabaseErrors(
					db
						.select(integrationSelection)
						.from(schema.integration)
						.where(and(...conditions))
						.orderBy(desc(schema.integration.createdAt)),
				);

				return rows.map((row) => normalizeIntegration(frontendUrl, row));
			});

			const listForUser = Effect.fn("IntegrationsRepository.listForUser")(function* (input: {
				userId: UserId;
				isDisabled?: boolean | undefined;
				provider?: IntegrationProvider | undefined;
			}) {
				const db = yield* Database;
				const conditions = [eq(schema.integration.userId, input.userId)];
				if (input.provider !== undefined) {
					conditions.push(eq(schema.integration.provider, input.provider));
				}
				if (input.isDisabled !== undefined) {
					conditions.push(eq(schema.integration.isDisabled, input.isDisabled));
				}

				const rows = yield* mapDatabaseErrors(
					db
						.select(integrationSelection)
						.from(schema.integration)
						.where(and(...conditions))
						.orderBy(desc(schema.integration.createdAt)),
				);

				return rows.map((row) => normalizeIntegration(frontendUrl, row));
			});

			const listForBackup = Effect.fn("IntegrationsRepository.listForBackup")(function* (
				userId: UserId,
			) {
				const db = yield* Database;
				return yield* mapDatabaseErrors(
					db
						.select(integrationBackupSelection)
						.from(schema.integration)
						.where(eq(schema.integration.userId, userId))
						.orderBy(asc(schema.integration.id)),
				);
			});

			const restoreForUser = Effect.fn("IntegrationsRepository.restoreForUser")(function* (input: {
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
				readonly pluginInstallationId: string;
				readonly provider: IntegrationProvider;
				readonly extraSettings: IntegrationExtraSettings;
				readonly providerSpecifics: IntegrationProviderSettings;
			}) {
				const db = yield* Database;
				yield* mapDatabaseErrors(
					db
						.insert(schema.integration)
						.values({ ...input, webhookToken: webhookTokenForLot(input.lot) }),
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
				const db = yield* Database;
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
					updates.providerSpecifics = input.providerSpecifics;
				}

				if (Object.keys(updates).length === 0) {
					const [row] = yield* mapDatabaseErrors(
						db
							.select(integrationSelection)
							.from(schema.integration)
							.where(ownedIntegrationWhere(input))
							.limit(1),
					);
					return row ? normalizeIntegration(frontendUrl, row) : null;
				}

				const [row] = yield* mapDatabaseErrors(
					db
						.update(schema.integration)
						.set(updates)
						.where(ownedIntegrationWhere(input))
						.returning(integrationSelection),
				);

				return row ? normalizeIntegration(frontendUrl, row) : null;
			});

			const disableForUserIfEnabled = Effect.fn("IntegrationsRepository.disableForUserIfEnabled")(
				function* (input: { userId: UserId; integrationId: IntegrationId }) {
					const db = yield* Database;
					const [row] = yield* mapDatabaseErrors(
						db
							.update(schema.integration)
							.set({ isDisabled: true })
							.where(and(ownedIntegrationWhere(input), eq(schema.integration.isDisabled, false)))
							.returning({ id: schema.integration.id }),
					);
					return row !== undefined;
				},
			);

			const hasAutoDisableClaim = Effect.fn("IntegrationsRepository.hasAutoDisableClaim")(
				function* (importRunId: ImportRunId) {
					const db = yield* Database;
					const [row] = yield* mapDatabaseErrors(
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
					const db = yield* Database;
					yield* mapDatabaseErrors(
						db.insert(schema.integrationAutoDisableClaim).values(input).onConflictDoNothing(),
					);
				},
			);

			const deleteForUser = Effect.fn("IntegrationsRepository.deleteForUser")(function* (input: {
				userId: UserId;
				integrationId: IntegrationId;
			}) {
				const db = yield* Database;
				yield* mapDatabaseErrors(db.delete(schema.integration).where(ownedIntegrationWhere(input)));
			});

			return {
				getForUser,
				listForUser,
				listForBackup,
				createForUser,
				hasAnyForUser,
				updateForUser,
				deleteForUser,
				restoreForUser,
				getByIdAnyUser,
				getByWebhookToken,
				hasAutoDisableClaim,
				insertAutoDisableClaim,
				disableForUserIfEnabled,
				getUserDisableIntegrations,
				listEnabledYankIntegrations,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
