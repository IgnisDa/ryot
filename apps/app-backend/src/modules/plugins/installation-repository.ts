import type { UserId } from "@ryot/contract/schema/brands";
import { and, asc, eq, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

export type PluginInstallationRow = typeof schema.pluginInstallation.$inferSelect;

export type PluginInstallationHealth = PluginInstallationRow["health"];

export type PluginInstallationState = PluginInstallationRow & {
	readonly pluginSlug: string;
	readonly pluginScope: "system" | "user";
};

type RestoreInstallationInput = Omit<
	PluginInstallationRow,
	"userId" | "health" | "healthReason"
> & { readonly userId: UserId };

const provisionSystemInstallations = (userId: UserId | null) => sql`
	insert into ${schema.pluginInstallation} (id, user_id, plugin_id)
	select gen_random_uuid()::text, ${schema.user.id}, ${schema.plugin.id}
	from ${schema.user}
	cross join ${schema.plugin}
	where ${schema.plugin.scope} = 'system'
		and ${schema.plugin.status} = 'active'
		${userId === null ? sql`` : sql`and ${schema.user.id} = ${userId}`}
	on conflict (user_id, plugin_id) do nothing
`;

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
				yield* mapDatabaseErrors(db.execute(provisionSystemInstallations(userId)));
			});

			const provisionSystemInstallationsForAllUsers = Effect.fn(
				"PluginInstallationRepository.provisionSystemInstallationsForAllUsers",
			)(function* () {
				const db = yield* Database;
				yield* mapDatabaseErrors(db.execute(provisionSystemInstallations(null)));
			});

			// TODO(plugins): Task 09 owns archive format v2; this upsert last-wins on duplicate archive
			// entries for one plugin instead of rejecting them.
			const restore = Effect.fn("PluginInstallationRepository.restore")(function* (
				input: RestoreInstallationInput,
			) {
				const db = yield* Database;
				yield* mapDatabaseErrors(
					db
						.insert(schema.pluginInstallation)
						.values(input)
						.onConflictDoUpdate({
							target: [schema.pluginInstallation.userId, schema.pluginInstallation.pluginId],
							set: {
								config: input.config,
								sortOrder: input.sortOrder,
								createdAt: input.createdAt,
								updatedAt: input.updatedAt,
								isDisabled: input.isDisabled,
							},
						}),
				);
			});

			return {
				create,
				remove,
				restore,
				listForUser,
				updateState,
				upsertState,
				updateHealth,
				listSystemForUser,
				findByUserAndPlugin,
				provisionSystemInstallationsForUser,
				provisionSystemInstallationsForAllUsers,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
