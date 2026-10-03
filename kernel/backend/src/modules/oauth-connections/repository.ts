import type { OAuthConnectionClient } from "@ryot-app/contract/modules/oauth-connections/schemas";
import type {
	ImportRunId,
	IntegrationId,
	OAuthConnectionId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { and, count, eq, gt, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import type { SubkeyCiphertext } from "#lib/infrastructure/config/plugin-config-encryption";
import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";

const connection = schema.oauthConnection;

const connectionSelection = {
	id: connection.id,
	field: connection.field,
	client: connection.client,
	status: connection.status,
	userId: connection.userId,
	expiresAt: connection.expiresAt,
	pluginSlug: connection.pluginSlug,
	accessToken: connection.accessToken,
	refreshToken: connection.refreshToken,
	tokenVersion: connection.tokenVersion,
	integrationId: connection.integrationId,
	tokenUrlOrigin: connection.tokenUrlOrigin,
	oauthProviderSlug: connection.oauthProviderSlug,
	pluginInstallationId: connection.pluginInstallationId,
	accessTokenExpiresAt: connection.accessTokenExpiresAt,
	integrationProviderSlug: connection.integrationProviderSlug,
};

const unexpiredAt = (now: Date) => gt(connection.expiresAt, now);

export class OAuthConnectionsRepository extends Context.Service<OAuthConnectionsRepository>()(
	"OAuthConnectionsRepository",
	{
		make: Effect.gen(function* () {
			const database = yield* DatabaseSession;

			const countOpenForUser = Effect.fn("OAuthConnectionsRepository.countOpenForUser")(function* (
				userId: UserId,
				now: Date,
			) {
				const [row] = yield* database.run((db) =>
					db
						.select({ total: count() })
						.from(connection)
						.where(
							and(
								eq(connection.userId, userId),
								inArray(connection.status, ["pending", "authorized"]),
								unexpiredAt(now),
							),
						),
				);
				return row?.total ?? 0;
			});

			const insertPending = Effect.fn("OAuthConnectionsRepository.insertPending")(
				function* (input: {
					readonly id: OAuthConnectionId;
					readonly field: string;
					readonly userId: UserId;
					readonly expiresAt: Date;
					readonly stateHash: string;
					readonly pluginSlug: string;
					readonly tokenUrlOrigin: string;
					readonly oauthProviderSlug: string;
					readonly pluginInstallationId: string;
					readonly client: OAuthConnectionClient;
					readonly integrationProviderSlug: string;
					readonly codeVerifier?: SubkeyCiphertext;
				}) {
					yield* database.run((db) =>
						db.insert(connection).values({ ...input, status: "pending" }),
					);
				},
			);

			const findPendingByStateHash = Effect.fn("OAuthConnectionsRepository.findPendingByStateHash")(
				function* (stateHash: string, now: Date) {
					const [row] = yield* database.run((db) =>
						db
							.select(connectionSelection)
							.from(connection)
							.where(
								and(
									eq(connection.stateHash, stateHash),
									eq(connection.status, "pending"),
									unexpiredAt(now),
								),
							)
							.limit(1),
					);
					return row ?? null;
				},
			);

			const authorize = Effect.fn("OAuthConnectionsRepository.authorize")(function* (input: {
				readonly now: Date;
				readonly stateHash: string;
				readonly code: SubkeyCiphertext;
				readonly id: OAuthConnectionId;
				readonly completionSecretHash: string;
			}) {
				const rows = yield* database.run((db) =>
					db
						.update(connection)
						.set({
							code: input.code,
							status: "authorized",
							completionSecretHash: input.completionSecretHash,
						})
						.where(
							and(
								eq(connection.id, input.id),
								eq(connection.status, "pending"),
								eq(connection.stateHash, input.stateHash),
								unexpiredAt(input.now),
							),
						)
						.returning({ id: connection.id }),
				);
				return rows.length === 1;
			});

			const markFailed = Effect.fn("OAuthConnectionsRepository.markFailed")(function* (input: {
				readonly id: OAuthConnectionId;
				readonly from: "authorized" | "pending";
			}) {
				yield* database.run((db) =>
					db
						.update(connection)
						.set({
							code: null,
							status: "failed",
							codeVerifier: null,
							refreshLeaseUntil: null,
							completionSecretHash: null,
						})
						.where(and(eq(connection.id, input.id), eq(connection.status, input.from))),
				);
			});

			const claimCompletion = Effect.fn("OAuthConnectionsRepository.claimCompletion")(
				function* (input: {
					readonly now: Date;
					readonly userId: UserId;
					readonly leaseUntil: Date;
					readonly id: OAuthConnectionId;
					readonly completionSecretHash: string;
				}) {
					const [row] = yield* database.run((db) =>
						db
							.update(connection)
							.set({ completionSecretHash: null, refreshLeaseUntil: input.leaseUntil })
							.where(
								and(
									eq(connection.id, input.id),
									eq(connection.userId, input.userId),
									eq(connection.status, "authorized"),
									eq(connection.completionSecretHash, input.completionSecretHash),
									unexpiredAt(input.now),
								),
							)
							.returning({
								...connectionSelection,
								code: connection.code,
								codeVerifier: connection.codeVerifier,
							}),
					);
					return row ?? null;
				},
			);

			const markConnected = Effect.fn("OAuthConnectionsRepository.markConnected")(
				function* (input: {
					readonly expiresAt: Date;
					readonly id: OAuthConnectionId;
					readonly accessTokenExpiresAt: Date;
					readonly accessToken: SubkeyCiphertext;
					readonly refreshToken: SubkeyCiphertext | null;
				}) {
					const rows = yield* database.run((db) =>
						db
							.update(connection)
							.set({
								code: null,
								codeVerifier: null,
								status: "connected",
								refreshLeaseUntil: null,
								expiresAt: input.expiresAt,
								accessToken: input.accessToken,
								refreshToken: input.refreshToken,
								accessTokenExpiresAt: input.accessTokenExpiresAt,
								tokenVersion: sql`${connection.tokenVersion} + 1`,
							})
							.where(and(eq(connection.id, input.id), eq(connection.status, "authorized")))
							.returning({ id: connection.id }),
					);
					return rows.length === 1;
				},
			);

			const findForUser = Effect.fn("OAuthConnectionsRepository.findForUser")(function* (
				id: OAuthConnectionId,
				userId: UserId,
			) {
				const [row] = yield* database.run((db) =>
					db
						.select(connectionSelection)
						.from(connection)
						.where(and(eq(connection.id, id), eq(connection.userId, userId)))
						.limit(1),
				);
				return row ?? null;
			});

			const findById = Effect.fn("OAuthConnectionsRepository.findById")(function* (
				id: OAuthConnectionId,
			) {
				const [row] = yield* database.run((db) =>
					db.select(connectionSelection).from(connection).where(eq(connection.id, id)).limit(1),
				);
				return row ?? null;
			});

			const listReadinessForUser = Effect.fn("OAuthConnectionsRepository.listReadinessForUser")(
				function* (userId: UserId, pluginInstallationId: string, integrationProviderSlug: string) {
					return yield* database.run((db) =>
						db
							.select({
								id: connection.id,
								field: connection.field,
								status: connection.status,
								expiresAt: connection.expiresAt,
								integrationId: connection.integrationId,
								oauthProviderSlug: connection.oauthProviderSlug,
							})
							.from(connection)
							.where(
								and(
									eq(connection.userId, userId),
									eq(connection.pluginInstallationId, pluginInstallationId),
									eq(connection.integrationProviderSlug, integrationProviderSlug),
								),
							),
					);
				},
			);

			const findIntegrationForUser = Effect.fn("OAuthConnectionsRepository.findIntegrationForUser")(
				function* (integrationId: IntegrationId, userId: UserId) {
					const [row] = yield* database.run((db) =>
						db
							.select({
								provider: schema.integration.provider,
								pluginInstallationId: schema.integration.pluginInstallationId,
							})
							.from(schema.integration)
							.where(
								and(
									eq(schema.integration.id, integrationId),
									eq(schema.integration.userId, userId),
								),
							)
							.limit(1),
					);
					return row ?? null;
				},
			);

			const findOAuthProviders = Effect.fn("OAuthConnectionsRepository.findOAuthProviders")(
				function* (pluginRevisionId: string) {
					const [row] = yield* database.run((db) =>
						db
							.select({
								oauthProviders: sql<unknown>`${schema.pluginRevision.manifest} -> 'oauthProviders'`,
							})
							.from(schema.pluginRevision)
							.where(eq(schema.pluginRevision.id, pluginRevisionId))
							.limit(1),
					);
					return row?.oauthProviders ?? null;
				},
			);

			const bindToIntegration = Effect.fn("OAuthConnectionsRepository.bindToIntegration")(
				function* (input: {
					readonly now: Date;
					readonly field: string;
					readonly userId: UserId;
					readonly id: OAuthConnectionId;
					readonly integrationId: IntegrationId;
					readonly pluginInstallationId: string;
					readonly integrationProviderSlug: string;
				}) {
					const [bound] = yield* database.run((db) =>
						db
							.select({ id: connection.id })
							.from(connection)
							.where(
								and(
									eq(connection.integrationId, input.integrationId),
									eq(connection.field, input.field),
								),
							)
							.limit(1),
					);
					if (bound?.id === input.id) {
						return true;
					}
					yield* database.run((db) =>
						db
							.delete(connection)
							.where(
								and(
									eq(connection.integrationId, input.integrationId),
									eq(connection.field, input.field),
									ne(connection.id, input.id),
								),
							),
					);
					const rows = yield* database.run((db) =>
						db
							.update(connection)
							.set({ expiresAt: null, integrationId: input.integrationId })
							.where(
								and(
									eq(connection.id, input.id),
									eq(connection.field, input.field),
									eq(connection.userId, input.userId),
									eq(connection.status, "connected"),
									isNull(connection.integrationId),
									eq(connection.pluginInstallationId, input.pluginInstallationId),
									eq(connection.integrationProviderSlug, input.integrationProviderSlug),
									unexpiredAt(input.now),
								),
							)
							.returning({ id: connection.id }),
					);
					return rows.length === 1;
				},
			);

			const findForIntegrationRun = Effect.fn("OAuthConnectionsRepository.findForIntegrationRun")(
				function* (input: {
					readonly field: string;
					readonly userId: UserId;
					readonly integrationId: IntegrationId;
					readonly integrationRunId: ImportRunId;
				}) {
					const [row] = yield* database.run((db) =>
						db
							.select({
								...connectionSelection,
								pins: schema.importRun.pins,
								pluginOwnerId: schema.plugin.ownerId,
								manifest: schema.pluginRevision.manifest,
								installationPluginSlug: schema.plugin.slug,
								pluginId: schema.pluginInstallation.pluginId,
							})
							.from(connection)
							.innerJoin(
								schema.integration,
								and(
									eq(schema.integration.id, connection.integrationId),
									eq(schema.integration.userId, connection.userId),
									eq(schema.integration.provider, connection.integrationProviderSlug),
									eq(schema.integration.pluginInstallationId, connection.pluginInstallationId),
								),
							)
							.innerJoin(
								schema.importRun,
								and(
									eq(schema.importRun.integrationId, schema.integration.id),
									eq(schema.importRun.userId, schema.integration.userId),
								),
							)
							.innerJoin(
								schema.pluginInstallation,
								and(
									eq(schema.pluginInstallation.id, connection.pluginInstallationId),
									eq(schema.pluginInstallation.userId, connection.userId),
								),
							)
							.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginInstallation.pluginId))
							.innerJoin(
								schema.pluginRevision,
								and(
									eq(schema.pluginRevision.pluginId, schema.pluginInstallation.pluginId),
									sql`${schema.pluginRevision.id} = ${schema.importRun.pins} ->> 'pluginRevisionId'`,
								),
							)
							.where(
								and(
									eq(connection.field, input.field),
									eq(connection.userId, input.userId),
									eq(connection.integrationId, input.integrationId),
									eq(schema.importRun.id, input.integrationRunId),
									eq(schema.importRun.status, "running"),
								),
							)
							.limit(1),
					);
					return row ?? null;
				},
			);

			const acquireRefreshLease = Effect.fn("OAuthConnectionsRepository.acquireRefreshLease")(
				function* (input: {
					readonly now: Date;
					readonly leaseUntil: Date;
					readonly tokenVersion: number;
					readonly id: OAuthConnectionId;
				}) {
					const rows = yield* database.run((db) =>
						db
							.update(connection)
							.set({ refreshLeaseUntil: input.leaseUntil })
							.where(
								and(
									eq(connection.id, input.id),
									eq(connection.status, "connected"),
									eq(connection.tokenVersion, input.tokenVersion),
									or(
										isNull(connection.refreshLeaseUntil),
										lte(connection.refreshLeaseUntil, input.now),
									),
								),
							)
							.returning({ id: connection.id }),
					);
					return rows.length === 1;
				},
			);

			const storeRefreshedTokens = Effect.fn("OAuthConnectionsRepository.storeRefreshedTokens")(
				function* (input: {
					readonly tokenVersion: number;
					readonly id: OAuthConnectionId;
					readonly accessTokenExpiresAt: Date;
					readonly accessToken: SubkeyCiphertext;
					readonly refreshToken: SubkeyCiphertext;
				}) {
					const rows = yield* database.run((db) =>
						db
							.update(connection)
							.set({
								refreshLeaseUntil: null,
								accessToken: input.accessToken,
								refreshToken: input.refreshToken,
								tokenVersion: input.tokenVersion + 1,
								accessTokenExpiresAt: input.accessTokenExpiresAt,
							})
							.where(
								and(
									eq(connection.id, input.id),
									eq(connection.status, "connected"),
									eq(connection.tokenVersion, input.tokenVersion),
								),
							)
							.returning({ id: connection.id }),
					);
					return rows.length === 1;
				},
			);

			const markExpired = Effect.fn("OAuthConnectionsRepository.markExpired")(function* (input: {
				readonly tokenVersion: number;
				readonly id: OAuthConnectionId;
				readonly integrationId: IntegrationId;
			}) {
				const rows = yield* database.run((db) =>
					db
						.update(connection)
						.set({
							status: "expired",
							accessToken: null,
							refreshToken: null,
							refreshLeaseUntil: null,
							accessTokenExpiresAt: null,
							tokenVersion: input.tokenVersion + 1,
						})
						.where(
							and(
								eq(connection.id, input.id),
								eq(connection.status, "connected"),
								eq(connection.tokenVersion, input.tokenVersion),
								eq(connection.integrationId, input.integrationId),
							),
						)
						.returning({ id: connection.id }),
				);
				return rows.length === 1;
			});

			const releaseRefreshLease = Effect.fn("OAuthConnectionsRepository.releaseRefreshLease")(
				function* (input: { readonly tokenVersion: number; readonly id: OAuthConnectionId }) {
					yield* database.run((db) =>
						db
							.update(connection)
							.set({ refreshLeaseUntil: null })
							.where(
								and(eq(connection.id, input.id), eq(connection.tokenVersion, input.tokenVersion)),
							),
					);
				},
			);

			const deleteExpired = Effect.fn("OAuthConnectionsRepository.deleteExpired")(function* (
				now: Date,
				limit: number,
			) {
				const rows = yield* database.run((db) =>
					db
						.delete(connection)
						.where(
							inArray(
								connection.id,
								db
									.select({ id: connection.id })
									.from(connection)
									.where(and(isNull(connection.integrationId), lte(connection.expiresAt, now)))
									.limit(limit),
							),
						)
						.returning({ id: connection.id }),
				);
				return rows.length;
			});

			return {
				findById,
				authorize,
				markFailed,
				findForUser,
				markExpired,
				insertPending,
				markConnected,
				deleteExpired,
				claimCompletion,
				countOpenForUser,
				bindToIntegration,
				findOAuthProviders,
				acquireRefreshLease,
				releaseRefreshLease,
				listReadinessForUser,
				storeRefreshedTokens,
				findForIntegrationRun,
				findPendingByStateHash,
				findIntegrationForUser,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
