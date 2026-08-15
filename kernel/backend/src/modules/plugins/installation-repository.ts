import type { UserId } from "@ryot/contract/schema/brands";
import { and, asc, eq, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

export type PluginInstallationRow = typeof schema.pluginInstallation.$inferSelect;

export type PluginInstallationHealth = PluginInstallationRow["health"];

type PluginRow = typeof schema.plugin.$inferSelect;

export type PluginPrivateInstallationRow = Pick<
	PluginInstallationRow,
	"userId" | "health" | "healthReason"
> & {
	readonly pluginId: PluginRow["id"];
	readonly pluginSlug: PluginRow["slug"];
	readonly manifest: PluginRow["manifest"];
	readonly installationId: PluginInstallationRow["id"];
};

export type PluginInstallationState = PluginInstallationRow & {
	readonly pluginSlug: string;
	readonly pluginScope: "system" | "user";
};

type RestoreInstallationInput = Omit<PluginInstallationRow, "userId" | "healthReason"> & {
	readonly userId: UserId;
	readonly preserveExistingConfig: boolean;
};

const provisionSystemInstallations = (
	userId: UserId | null,
	health: PluginInstallationHealth,
) => sql`
	insert into ${schema.pluginInstallation} (id, user_id, plugin_id, health)
	select gen_random_uuid()::text, ${schema.user.id}, ${schema.plugin.id}, ${health}
	from ${schema.user}
	cross join ${schema.plugin}
	where ${schema.plugin.scope} = 'system'
		and ${schema.plugin.status} = 'active'
		${
			userId === null
				? sql`and ${schema.user.bootstrapCompletedAt} is not null`
				: sql`and ${schema.user.id} = ${userId}`
		}
	on conflict (user_id, plugin_id) do nothing
`;

const privateInstallation = {
	pluginId: schema.plugin.id,
	pluginSlug: schema.plugin.slug,
	manifest: schema.plugin.manifest,
	userId: schema.pluginInstallation.userId,
	health: schema.pluginInstallation.health,
	installationId: schema.pluginInstallation.id,
	healthReason: schema.pluginInstallation.healthReason,
};

const installationState = {
	pluginSlug: schema.plugin.slug,
	pluginScope: schema.plugin.scope,
	id: schema.pluginInstallation.id,
	userId: schema.pluginInstallation.userId,
	config: schema.pluginInstallation.config,
	health: schema.pluginInstallation.health,
	pluginId: schema.pluginInstallation.pluginId,
	sortOrder: schema.pluginInstallation.sortOrder,
	createdAt: schema.pluginInstallation.createdAt,
	updatedAt: schema.pluginInstallation.updatedAt,
	isDisabled: schema.pluginInstallation.isDisabled,
	healthReason: schema.pluginInstallation.healthReason,
};

export class PluginInstallationRepository extends Context.Service<PluginInstallationRepository>()(
	"PluginInstallationRepository",
	{
		make: Effect.sync(() => {
			const findById = Effect.fn("PluginInstallationRepository.findById")(function* (id: string) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select(installationState)
						.from(schema.pluginInstallation)
						.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginInstallation.pluginId))
						.where(eq(schema.pluginInstallation.id, id))
						.limit(1),
				);
				return row ?? null;
			});
			const listForUser = Effect.fn("PluginInstallationRepository.listForUser")(function* (
				userId: UserId,
			) {
				const db = yield* Database;
				return yield* mapDatabaseErrors(
					db
						.select(installationState)
						.from(schema.pluginInstallation)
						.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginInstallation.pluginId))
						.where(eq(schema.pluginInstallation.userId, userId))
						.orderBy(asc(schema.pluginInstallation.sortOrder), asc(schema.plugin.slug)),
				);
			});

			const listSystemForUser = Effect.fn("PluginInstallationRepository.listSystemForUser")(
				function* (userId: UserId) {
					const db = yield* Database;
					return yield* mapDatabaseErrors(
						db
							.select(installationState)
							.from(schema.pluginInstallation)
							.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginInstallation.pluginId))
							.where(
								and(
									eq(schema.plugin.scope, "system"),
									eq(schema.plugin.status, "active"),
									eq(schema.pluginInstallation.userId, userId),
								),
							)
							.orderBy(asc(schema.pluginInstallation.sortOrder), asc(schema.plugin.slug)),
					);
				},
			);

			const findByUserAndPlugin = Effect.fn("PluginInstallationRepository.findByUserAndPlugin")(
				function* (userId: UserId, pluginId: string) {
					const db = yield* Database;
					const [row] = yield* mapDatabaseErrors(
						db
							.select(installationState)
							.from(schema.pluginInstallation)
							.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginInstallation.pluginId))
							.where(
								and(
									eq(schema.pluginInstallation.userId, userId),
									eq(schema.pluginInstallation.pluginId, pluginId),
								),
							)
							.limit(1),
					);
					return row ?? null;
				},
			);

			const create = Effect.fn("PluginInstallationRepository.create")(function* (input: {
				userId: UserId;
				pluginId: string;
				sortOrder: number;
				isDisabled: boolean;
				config: Record<string, unknown>;
				health: PluginInstallationHealth;
			}) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db.insert(schema.pluginInstallation).values(input).returning(),
				);
				return row;
			});

			const updateHealth = Effect.fn("PluginInstallationRepository.updateHealth")(
				function* (input: {
					id: string;
					healthReason: string | null;
					health: PluginInstallationHealth;
				}) {
					const db = yield* Database;
					yield* mapDatabaseErrors(
						db
							.update(schema.pluginInstallation)
							.set({ health: input.health, healthReason: input.healthReason })
							.where(eq(schema.pluginInstallation.id, input.id)),
					);
				},
			);

			const upsertState = Effect.fn("PluginInstallationRepository.upsertState")(function* (input: {
				userId: UserId;
				pluginId: string;
				sortOrder: number;
				isDisabled: boolean;
				config: Record<string, unknown>;
				health: PluginInstallationHealth;
			}) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.insert(schema.pluginInstallation)
						.values({ ...input, healthReason: null })
						.onConflictDoUpdate({
							target: [schema.pluginInstallation.userId, schema.pluginInstallation.pluginId],
							set: {
								healthReason: null,
								config: input.config,
								health: input.health,
								sortOrder: input.sortOrder,
								isDisabled: input.isDisabled,
							},
						})
						.returning(),
				);
				return row;
			});

			const updateState = Effect.fn("PluginInstallationRepository.updateState")(function* (input: {
				id: string;
				sortOrder: number;
				isDisabled: boolean;
				config: Record<string, unknown>;
			}) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.update(schema.pluginInstallation)
						.set({
							config: input.config,
							sortOrder: input.sortOrder,
							isDisabled: input.isDisabled,
						})
						.where(eq(schema.pluginInstallation.id, input.id))
						.returning(),
				);
				return row;
			});

			const remove = Effect.fn("PluginInstallationRepository.remove")(function* (id: string) {
				const db = yield* Database;
				yield* mapDatabaseErrors(
					db.delete(schema.pluginInstallation).where(eq(schema.pluginInstallation.id, id)),
				);
			});

			const provisionSystemInstallationsForUser = Effect.fn(
				"PluginInstallationRepository.provisionSystemInstallationsForUser",
			)(function* (userId: UserId) {
				const db = yield* Database;
				yield* mapDatabaseErrors(db.execute(provisionSystemInstallations(userId, "ready")));
			});

			const provisionSystemInstallationsForAllUsers = Effect.fn(
				"PluginInstallationRepository.provisionSystemInstallationsForAllUsers",
			)(function* () {
				const db = yield* Database;
				yield* mapDatabaseErrors(db.execute(provisionSystemInstallations(null, "installing")));
			});

			const listPendingLifecycle = Effect.fn("PluginInstallationRepository.listPendingLifecycle")(
				function* () {
					const db = yield* Database;
					const rows = yield* mapDatabaseErrors(
						db
							.select({ id: schema.pluginInstallation.id })
							.from(schema.pluginInstallation)
							.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginInstallation.pluginId))
							.where(
								and(
									eq(schema.plugin.status, "active"),
									eq(schema.pluginInstallation.health, "installing"),
								),
							)
							.orderBy(asc(schema.pluginInstallation.createdAt), asc(schema.pluginInstallation.id)),
					);
					return rows.map(({ id }) => id);
				},
			);

			const listPrivateInstallations = Effect.fn(
				"PluginInstallationRepository.listPrivateInstallations",
			)(function* () {
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.select(privateInstallation)
						.from(schema.pluginInstallation)
						.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginInstallation.pluginId))
						.where(and(eq(schema.plugin.scope, "user"), eq(schema.plugin.status, "active")))
						.orderBy(asc(schema.pluginInstallation.userId), asc(schema.plugin.slug)),
				);
				return rows satisfies ReadonlyArray<PluginPrivateInstallationRow>;
			});

			const restore = Effect.fn("PluginInstallationRepository.restore")(function* (
				input: RestoreInstallationInput,
			) {
				const db = yield* Database;
				const { preserveExistingConfig, ...values } = input;
				const [row] = yield* mapDatabaseErrors(
					db
						.insert(schema.pluginInstallation)
						.values(values)
						.onConflictDoUpdate({
							target: [schema.pluginInstallation.userId, schema.pluginInstallation.pluginId],
							set: {
								healthReason: null,
								...(preserveExistingConfig ? {} : { config: input.config }),
								health: input.health,
								sortOrder: input.sortOrder,
								createdAt: input.createdAt,
								updatedAt: input.updatedAt,
								isDisabled: input.isDisabled,
							},
						})
						.returning(),
				);
				return row;
			});

			const activateRestored = Effect.fn("PluginInstallationRepository.activateRestored")(
				function* (input: {
					readonly id: string;
					readonly updatedAt: Date;
					readonly isDisabled: boolean;
					readonly health: "ready" | "needs-configuration";
				}) {
					const db = yield* Database;
					const [row] = yield* mapDatabaseErrors(
						db
							.update(schema.pluginInstallation)
							.set({
								health: input.health,
								updatedAt: input.updatedAt,
								healthReason: null,
								isDisabled: input.isDisabled,
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
				create,
				remove,
				restore,
				findById,
				listForUser,
				updateState,
				upsertState,
				updateHealth,
				activateRestored,
				listSystemForUser,
				findByUserAndPlugin,
				listPendingLifecycle,
				listPrivateInstallations,
				provisionSystemInstallationsForUser,
				provisionSystemInstallationsForAllUsers,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
