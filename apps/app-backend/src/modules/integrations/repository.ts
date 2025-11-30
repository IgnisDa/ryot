import { and, desc, eq } from "drizzle-orm";
import { Effect } from "effect";

import { AppConfig } from "#lib/config";
import { CurrentDb, dbEffect } from "#lib/db";
import { user } from "#lib/db/schema/auth";
import * as schema from "#lib/db/schema/tables";
import { IntegrationId, UserId } from "#lib/schema/brands";

import type {
	IntegrationExtraSettings,
	IntegrationLot,
	IntegrationProvider,
	IntegrationProviderSpecifics,
	ListedIntegration,
} from "./schemas";
import { isSinkProvider } from "./types";

type IntegrationRow = {
	readonly id: string;
	readonly userId: string;
	readonly createdAt: Date;
	readonly updatedAt: Date;
	readonly name: string | null;
	readonly isDisabled: boolean;
	readonly lot: IntegrationLot;
	readonly syncOwnership: boolean;
	readonly minimumProgress: string;
	readonly maximumProgress: string;
	readonly lastFinishedAt: Date | null;
	readonly provider: IntegrationProvider;
	readonly extraSettings: IntegrationExtraSettings;
	readonly providerSpecifics: IntegrationProviderSpecifics;
};

export type IntegrationRecord = ListedIntegration & { readonly userId: UserId };

const integrationSelection = {
	id: schema.integration.id,
	lot: schema.integration.lot,
	name: schema.integration.name,
	userId: schema.integration.userId,
	provider: schema.integration.provider,
	createdAt: schema.integration.createdAt,
	updatedAt: schema.integration.updatedAt,
	isDisabled: schema.integration.isDisabled,
	extraSettings: schema.integration.extraSettings,
	syncOwnership: schema.integration.syncOwnership,
	lastFinishedAt: schema.integration.lastFinishedAt,
	minimumProgress: schema.integration.minimumProgress,
	maximumProgress: schema.integration.maximumProgress,
	providerSpecifics: schema.integration.providerSpecifics,
};

const normalizeIntegration = (frontendUrl: string, row: IntegrationRow): IntegrationRecord => ({
	id: IntegrationId.make(row.id),
	lot: row.lot,
	name: row.name,
	userId: UserId.make(row.userId),
	provider: row.provider,
	isDisabled: row.isDisabled,
	syncOwnership: row.syncOwnership,
	extraSettings: row.extraSettings,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	providerSpecifics: row.providerSpecifics,
	minimumProgress: Number.parseFloat(row.minimumProgress),
	maximumProgress: Number.parseFloat(row.maximumProgress),
	lastFinishedAt: row.lastFinishedAt?.toISOString() ?? null,
	webhookUrl: isSinkProvider(row.provider) ? `${frontendUrl}/_i/${row.id}` : undefined,
});

export class IntegrationsRepository extends Effect.Service<IntegrationsRepository>()(
	"IntegrationsRepository",
	{
		effect: Effect.gen(function* () {
			const { frontendUrl } = yield* AppConfig;

			const createForUser = Effect.fn("IntegrationsRepository.createForUser")(function* (input: {
				userId: UserId;
				lot: IntegrationLot;
				isDisabled: boolean;
				name?: string | null;
				syncOwnership: boolean;
				minimumProgress: string;
				maximumProgress: string;
				provider: IntegrationProvider;
				extraSettings: IntegrationExtraSettings;
				providerSpecifics: IntegrationProviderSpecifics;
			}) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.insert(schema.integration)
						.values({
							lot: input.lot,
							userId: input.userId,
							provider: input.provider,
							name: input.name ?? null,
							isDisabled: input.isDisabled,
							extraSettings: input.extraSettings,
							syncOwnership: input.syncOwnership,
							minimumProgress: input.minimumProgress,
							maximumProgress: input.maximumProgress,
							providerSpecifics: input.providerSpecifics,
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
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select(integrationSelection)
						.from(schema.integration)
						.where(eq(schema.integration.id, input.integrationId))
						.limit(1),
				);

				return row ? normalizeIntegration(frontendUrl, row) : null;
			});

			const getForUser = Effect.fn("IntegrationsRepository.getForUser")(function* (input: {
				userId: UserId;
				integrationId: IntegrationId;
			}) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select(integrationSelection)
						.from(schema.integration)
						.where(
							and(
								eq(schema.integration.id, input.integrationId),
								eq(schema.integration.userId, input.userId),
							),
						)
						.limit(1),
				);

				return row ? normalizeIntegration(frontendUrl, row) : null;
			});

			const getUserDisableIntegrations = Effect.fn(
				"IntegrationsRepository.getUserDisableIntegrations",
			)(function* (input: { userId: UserId }) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
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
			)(function* () {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.select(integrationSelection)
						.from(schema.integration)
						.where(
							and(eq(schema.integration.lot, "yank"), eq(schema.integration.isDisabled, false)),
						)
						.orderBy(desc(schema.integration.createdAt)),
				);

				return rows.map((row) => normalizeIntegration(frontendUrl, row));
			});

			const listForUser = Effect.fn("IntegrationsRepository.listForUser")(function* (input: {
				userId: UserId;
				isDisabled?: boolean;
				provider?: IntegrationProvider;
			}) {
				const db = yield* CurrentDb;
				const conditions = [eq(schema.integration.userId, input.userId)];
				if (input.provider !== undefined) {
					conditions.push(eq(schema.integration.provider, input.provider));
				}
				if (input.isDisabled !== undefined) {
					conditions.push(eq(schema.integration.isDisabled, input.isDisabled));
				}

				const rows = yield* dbEffect(() =>
					db
						.select(integrationSelection)
						.from(schema.integration)
						.where(and(...conditions))
						.orderBy(desc(schema.integration.createdAt)),
				);

				return rows.map((row) => normalizeIntegration(frontendUrl, row));
			});

			const updateForUser = Effect.fn("IntegrationsRepository.updateForUser")(function* (input: {
				userId: UserId;
				name?: string | null;
				isDisabled?: boolean;
				integrationId: IntegrationId;
				syncOwnership?: boolean;
				minimumProgress?: string;
				maximumProgress?: string;
				lastFinishedAt?: Date | null;
				extraSettings?: IntegrationExtraSettings;
				providerSpecifics?: IntegrationProviderSpecifics;
			}) {
				const db = yield* CurrentDb;
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
					const [row] = yield* dbEffect(() =>
						db
							.select(integrationSelection)
							.from(schema.integration)
							.where(
								and(
									eq(schema.integration.id, input.integrationId),
									eq(schema.integration.userId, input.userId),
								),
							)
							.limit(1),
					);
					return row ? normalizeIntegration(frontendUrl, row) : null;
				}

				const [row] = yield* dbEffect(() =>
					db
						.update(schema.integration)
						.set(updates)
						.where(
							and(
								eq(schema.integration.id, input.integrationId),
								eq(schema.integration.userId, input.userId),
							),
						)
						.returning(integrationSelection),
				);

				return row ? normalizeIntegration(frontendUrl, row) : null;
			});

			const deleteForUser = Effect.fn("IntegrationsRepository.deleteForUser")(function* (input: {
				userId: UserId;
				integrationId: IntegrationId;
			}) {
				const db = yield* CurrentDb;
				yield* dbEffect(() =>
					db
						.delete(schema.integration)
						.where(
							and(
								eq(schema.integration.id, input.integrationId),
								eq(schema.integration.userId, input.userId),
							),
						),
				);
			});

			return {
				createForUser,
				getByIdAnyUser,
				getForUser,
				getUserDisableIntegrations,
				listEnabledYankIntegrations,
				listForUser,
				updateForUser,
				deleteForUser,
			};
		}),
	},
) {}
