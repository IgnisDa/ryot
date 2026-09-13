import { DbError } from "@ryot-app/contract/errors";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";

import { redactPluginConfig } from "./config-redaction";
import { PluginConfigRevisions } from "./config-revisions";

type StoredInstallationRow = Omit<
	typeof schema.pluginInstallation.$inferSelect,
	"clientConfig" | "configuredSecretPaths"
>;
export type PluginInstallationRow = StoredInstallationRow & {
	readonly config: Record<string, unknown>;
	readonly configSchema?: (typeof schema.pluginRevision.$inferSelect)["manifest"]["configSchema"];
};

export type PluginInstallationHealth = PluginInstallationRow["health"];

type PluginRow = typeof schema.plugin.$inferSelect;

export type PluginPrivateInstallationRow = Pick<
	PluginInstallationRow,
	"userId" | "health" | "healthReason"
> & {
	readonly pluginId: PluginRow["id"];
	readonly pluginSlug: PluginRow["slug"];
	readonly manifest: (typeof schema.pluginRevision.$inferSelect)["manifest"];
	readonly installationId: PluginInstallationRow["id"];
};

export type PluginInstallationState = StoredInstallationRow & {
	readonly pluginSlug: string;
	readonly pluginScope: "system" | "user";
};

export type PluginInstallationHydratedState = PluginInstallationState &
	Pick<PluginInstallationRow, "config" | "configSchema">;

const provisionSystemInstallations = (
	userId: UserId | null,
	health: PluginInstallationHealth,
) => sql`
	insert into ${schema.pluginInstallation} (id, user_id, plugin_id, health)
	select gen_random_uuid()::text, ${schema.user.id}, ${schema.plugin.id}, ${health}
	from ${schema.user}
	cross join ${schema.plugin}
	where ${schema.plugin.ownerId} is null
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
	manifest: schema.pluginRevision.manifest,
	userId: schema.pluginInstallation.userId,
	health: schema.pluginInstallation.health,
	installationId: schema.pluginInstallation.id,
	healthReason: schema.pluginInstallation.healthReason,
};

const installationState = {
	pluginSlug: schema.plugin.slug,
	id: schema.pluginInstallation.id,
	userId: schema.pluginInstallation.userId,
	health: schema.pluginInstallation.health,
	pluginId: schema.pluginInstallation.pluginId,
	isHidden: schema.pluginInstallation.isHidden,
	sortOrder: schema.pluginInstallation.sortOrder,
	createdAt: schema.pluginInstallation.createdAt,
	updatedAt: schema.pluginInstallation.updatedAt,
	userSettings: schema.pluginInstallation.userSettings,
	healthReason: schema.pluginInstallation.healthReason,
	uninstalledAt: schema.pluginInstallation.uninstalledAt,
	homeSavedViewSlug: schema.pluginInstallation.homeSavedViewSlug,
	activeConfigRevisionId: schema.pluginInstallation.activeConfigRevisionId,
	pluginScope: sql<
		"system" | "user"
	>`case when ${schema.plugin.ownerId} is null then 'system' else 'user' end`,
};

export class PluginInstallationRepository extends Context.Service<PluginInstallationRepository>()(
	"PluginInstallationRepository",
	{
		make: Effect.gen(function* () {
			const database = yield* DatabaseSession;
			const configs = yield* PluginConfigRevisions;
			const hydrate = Effect.fn(function* <T extends StoredInstallationRow>(row: T) {
				const { activeConfigRevisionId } = row;
				if (!activeConfigRevisionId) {
					return { ...row, config: {} };
				}
				const [revision] = yield* database.run((db) =>
					db
						.select()
						.from(schema.pluginConfigRevision)
						.where(eq(schema.pluginConfigRevision.id, activeConfigRevisionId))
						.limit(1),
				);
				if (
					!revision ||
					revision.ownerUserId !== row.userId ||
					revision.pluginInstallationId !== row.id
				) {
					return yield* new DbError({ message: "Invalid installation configuration ownership" });
				}
				const [packageRevision] = yield* database.run((db) =>
					db
						.select()
						.from(schema.pluginRevision)
						.where(eq(schema.pluginRevision.id, revision.pluginRevisionId))
						.limit(1),
				);
				if (!packageRevision || packageRevision.pluginId !== row.pluginId) {
					return yield* new DbError({ message: "Invalid installation package ownership" });
				}
				return {
					...row,
					config: yield* configs.decrypt(revision),
					configSchema: packageRevision.manifest.configSchema,
				};
			});
			const lockPluginRevision = Effect.fn(function* (pluginId: string) {
				yield* database.run((db) =>
					db
						.select({ id: schema.plugin.id })
						.from(schema.plugin)
						.where(and(eq(schema.plugin.id, pluginId), isNotNull(schema.plugin.ownerId)))
						.for("share"),
				);
			});
			const lockProjectionInputs = Effect.fn(function* (pluginId: string) {
				yield* configs.lock(pluginId);
				yield* lockPluginRevision(pluginId);
			});
			const projectLockedClientConfig = Effect.fn(function* (id: string) {
				const [row] = yield* database.run((db) =>
					db
						.select({
							ownerId: schema.plugin.ownerId,
							installation: schema.pluginInstallation,
							manifest: schema.pluginRevision.manifest,
						})
						.from(schema.pluginInstallation)
						.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginInstallation.pluginId))
						.leftJoin(
							schema.pluginRevision,
							eq(schema.pluginRevision.id, schema.plugin.activeRevisionId),
						)
						.where(eq(schema.pluginInstallation.id, id))
						.limit(1),
				);
				if (!row) {
					return;
				}
				const activeSchema = row.manifest?.configSchema;
				const projection =
					row.ownerId === null || row.installation.uninstalledAt !== null || !activeSchema
						? { config: {}, configuredSecrets: [] }
						: yield* hydrate(row.installation).pipe(
								Effect.map((hydrated: PluginInstallationRow) =>
									redactPluginConfig(activeSchema, hydrated.config, hydrated.configSchema),
								),
							);
				yield* database.run((db) =>
					db
						.update(schema.pluginInstallation)
						.set({
							clientConfig: projection.config,
							configuredSecretPaths: projection.configuredSecrets,
						})
						.where(eq(schema.pluginInstallation.id, id)),
				);
			});
			const installationPluginId = Effect.fn(function* (id: string) {
				const [row] = yield* database.run((db) =>
					db
						.select({ pluginId: schema.pluginInstallation.pluginId })
						.from(schema.pluginInstallation)
						.where(eq(schema.pluginInstallation.id, id))
						.limit(1),
				);
				return row?.pluginId ?? null;
			});
			const refreshClientConfig = Effect.fn(function* (row: StoredInstallationRow) {
				yield* lockProjectionInputs(row.pluginId);
				yield* database.run((db) =>
					db
						.select({ id: schema.pluginInstallation.id })
						.from(schema.pluginInstallation)
						.where(eq(schema.pluginInstallation.id, row.id))
						.for("update"),
				);
				yield* projectLockedClientConfig(row.id);
			});
			const refreshClientConfigsForPlugin = Effect.fn(
				"PluginInstallationRepository.refreshClientConfigsForPlugin",
			)(function* (pluginId: string) {
				yield* lockPluginRevision(pluginId);
				const rows = yield* database.run((db) =>
					db
						.select({ id: schema.pluginInstallation.id })
						.from(schema.pluginInstallation)
						.where(
							and(
								eq(schema.pluginInstallation.pluginId, pluginId),
								isNull(schema.pluginInstallation.uninstalledAt),
							),
						)
						.orderBy(asc(schema.pluginInstallation.id))
						.for("update"),
				);
				yield* Effect.forEach(rows, ({ id }) => projectLockedClientConfig(id), { discard: true });
			});
			const saveConfig = Effect.fn(function* (
				row: StoredInstallationRow,
				properties: Record<string, unknown>,
				configuredSecretPaths?: ReadonlyArray<string>,
				allowMissingRequiredSecrets = false,
			) {
				yield* configs.lock(row.pluginId);
				const [plugin] = yield* database.run((db) =>
					db.select().from(schema.plugin).where(eq(schema.plugin.id, row.pluginId)).limit(1),
				);
				if (!plugin?.activeRevisionId) {
					return yield* new DbError({ message: "Plugin package revision is unavailable" });
				}
				if (plugin.ownerId === null) {
					return { ...row, config: {} };
				}
				if (plugin.ownerId !== row.userId) {
					return yield* new DbError({ message: "Invalid installation owner" });
				}
				const revisionInput = {
					properties,
					ownerUserId: row.userId,
					pluginInstallationId: row.id,
					scope: "installation" as const,
					pluginRevisionId: plugin.activeRevisionId,
				};
				const activeConfigRevisionId = yield* configuredSecretPaths === undefined
					? configs.create(revisionInput)
					: configs.createForRestore({
							...revisionInput,
							configuredSecretPaths,
							allowMissingRequiredSecrets,
						});
				const health = row.health === "needs-configuration" ? "ready" : row.health;
				yield* database.run((db) =>
					db
						.update(schema.pluginInstallation)
						.set({
							health,
							activeConfigRevisionId,
							healthReason: health === "ready" ? null : row.healthReason,
						})
						.where(eq(schema.pluginInstallation.id, row.id)),
				);
				yield* refreshClientConfig(row);
				return {
					...row,
					health,
					config: properties,
					activeConfigRevisionId,
					healthReason: health === "ready" ? null : row.healthReason,
				};
			});
			const findById = Effect.fn("PluginInstallationRepository.findById")(function* (id: string) {
				const [row] = yield* database.run((db) =>
					db
						.select(installationState)
						.from(schema.pluginInstallation)
						.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginInstallation.pluginId))
						.where(
							and(
								eq(schema.pluginInstallation.id, id),
								isNull(schema.pluginInstallation.uninstalledAt),
							),
						)
						.limit(1),
				);
				return row ?? null;
			});
			const listForUser = Effect.fn("PluginInstallationRepository.listForUser")(function* (
				userId: UserId,
			) {
				const rows = yield* database.run((db) =>
					db
						.select(installationState)
						.from(schema.pluginInstallation)
						.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginInstallation.pluginId))
						.where(
							and(
								eq(schema.pluginInstallation.userId, userId),
								isNull(schema.pluginInstallation.uninstalledAt),
							),
						)
						.orderBy(asc(schema.pluginInstallation.sortOrder), asc(schema.plugin.slug)),
				);
				return rows;
			});

			const listHydratedForUser = Effect.fn("PluginInstallationRepository.listHydratedForUser")(
				function* (userId: UserId) {
					return yield* Effect.forEach(yield* listForUser(userId), hydrate);
				},
			);

			const listSystemForUser = Effect.fn("PluginInstallationRepository.listSystemForUser")(
				function* (userId: UserId) {
					const rows = yield* database.run((db) =>
						db
							.select(installationState)
							.from(schema.pluginInstallation)
							.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginInstallation.pluginId))
							.where(
								and(
									isNull(schema.plugin.ownerId),
									isNull(schema.pluginInstallation.uninstalledAt),
									eq(schema.plugin.status, "active"),
									eq(schema.pluginInstallation.userId, userId),
								),
							)
							.orderBy(asc(schema.pluginInstallation.sortOrder), asc(schema.plugin.slug)),
					);
					return rows;
				},
			);

			const findByUserAndPlugin = Effect.fn("PluginInstallationRepository.findByUserAndPlugin")(
				function* (userId: UserId, pluginId: string) {
					const [row] = yield* database.run((db) =>
						db
							.select(installationState)
							.from(schema.pluginInstallation)
							.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginInstallation.pluginId))
							.where(
								and(
									eq(schema.pluginInstallation.userId, userId),
									eq(schema.pluginInstallation.pluginId, pluginId),
									isNull(schema.pluginInstallation.uninstalledAt),
								),
							)
							.limit(1),
					);
					return row ? yield* hydrate(row) : null;
				},
			);

			const findHomeSavedView = Effect.fn("PluginInstallationRepository.findHomeSavedView")(
				function* (userId: UserId, savedViewSlug: string) {
					const [row] = yield* database.run((db) =>
						db
							.select({
								view: {
									renderer: schema.userSavedViewEffective.renderer,
									isHidden: schema.userSavedViewEffective.isHidden,
								},
							})
							.from(schema.userSavedViewEffective)
							.where(
								and(
									eq(schema.userSavedViewEffective.slug, savedViewSlug),
									eq(schema.userSavedViewEffective.userId, userId),
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
				isHidden: boolean;
				config: Record<string, unknown>;
				health: PluginInstallationHealth;
			}) {
				yield* lockProjectionInputs(input.pluginId);
				const { config, ...values } = input;
				const [row] = yield* database.run((db) =>
					db.insert(schema.pluginInstallation).values(values).returning(),
				);
				return row ? yield* saveConfig(row, config) : undefined;
			});

			const updateHealth = Effect.fn("PluginInstallationRepository.updateHealth")(
				function* (input: {
					id: string;
					healthReason: string | null;
					health: PluginInstallationHealth;
				}) {
					yield* database.run((db) =>
						db
							.update(schema.pluginInstallation)
							.set({ health: input.health, healthReason: input.healthReason })
							.where(eq(schema.pluginInstallation.id, input.id)),
					);
				},
			);
			const updateHealthForActivation = Effect.fn(
				"PluginInstallationRepository.updateHealthForActivation",
			)(function* (input: Parameters<typeof updateHealth>[0] & { activationId: string }) {
				const [updated] = yield* database.run((db) =>
					db
						.update(schema.pluginInstallation)
						.set({ health: input.health, healthReason: input.healthReason })
						.where(
							and(
								eq(schema.pluginInstallation.id, input.id),
								isNull(schema.pluginInstallation.uninstalledAt),
								sql`exists (select 1 from ${schema.plugin} where ${schema.plugin.id} = ${schema.pluginInstallation.pluginId} and ${schema.plugin.status} = 'active' and ${schema.plugin.activationId} = ${input.activationId})`,
							),
						)
						.returning({ id: schema.pluginInstallation.id }),
				);
				return updated !== undefined;
			});

			const setHomeSavedView = Effect.fn("PluginInstallationRepository.setHomeSavedView")(
				function* (userId: UserId, id: string, homeSavedViewSlug: string | null) {
					const [row] = yield* database.run((db) =>
						db
							.update(schema.pluginInstallation)
							.set({ homeSavedViewSlug })
							.where(
								and(
									eq(schema.pluginInstallation.id, id),
									eq(schema.pluginInstallation.userId, userId),
								),
							)
							.returning({ id: schema.pluginInstallation.id }),
					);
					return row !== undefined;
				},
			);

			const clearHomeSavedViewReferences = Effect.fn(
				"PluginInstallationRepository.clearHomeSavedViewReferences",
			)(function* (userId: UserId, savedViewSlug: string) {
				yield* database.run((db) =>
					db
						.update(schema.pluginInstallation)
						.set({ homeSavedViewSlug: null })
						.where(
							and(
								eq(schema.pluginInstallation.userId, userId),
								eq(schema.pluginInstallation.homeSavedViewSlug, savedViewSlug),
							),
						),
				);
			});

			const upsertState = Effect.fn("PluginInstallationRepository.upsertState")(function* (input: {
				userId: UserId;
				pluginId: string;
				sortOrder: number;
				isHidden: boolean;
				config: Record<string, unknown>;
				health: PluginInstallationHealth;
			}) {
				yield* lockProjectionInputs(input.pluginId);
				const { config, ...values } = input;
				const [row] = yield* database.run((db) =>
					db
						.insert(schema.pluginInstallation)
						.values({ ...values, healthReason: null })
						.onConflictDoUpdate({
							target: [schema.pluginInstallation.userId, schema.pluginInstallation.pluginId],
							set: {
								healthReason: null,
								uninstalledAt: null,
								health: input.health,
								isHidden: input.isHidden,
								sortOrder: input.sortOrder,
							},
						})
						.returning(),
				);
				return row ? yield* saveConfig(row, config) : undefined;
			});

			const updateState = Effect.fn("PluginInstallationRepository.updateState")(function* (input: {
				id: string;
				sortOrder: number;
				isHidden: boolean;
				config: Record<string, unknown>;
			}) {
				const pluginId = yield* installationPluginId(input.id);
				if (pluginId !== null) {
					yield* lockProjectionInputs(pluginId);
				}
				const [row] = yield* database.run((db) =>
					db
						.update(schema.pluginInstallation)
						.set({ isHidden: input.isHidden, sortOrder: input.sortOrder })
						.where(eq(schema.pluginInstallation.id, input.id))
						.returning(),
				);
				return row ? yield* saveConfig(row, input.config) : undefined;
			});

			const remove = Effect.fn("PluginInstallationRepository.remove")(function* (id: string) {
				yield* database.run((db) =>
					db
						.update(schema.pluginInstallation)
						.set({
							isHidden: true,
							clientConfig: {},
							configuredSecretPaths: [],
							uninstalledAt: sql`now()`,
						})
						.where(eq(schema.pluginInstallation.id, id)),
				);
			});

			const provisionSystemInstallationsForUser = Effect.fn(
				"PluginInstallationRepository.provisionSystemInstallationsForUser",
			)(function* (userId: UserId) {
				yield* database.run((db) => db.execute(provisionSystemInstallations(userId, "ready")));
			});

			const provisionSystemInstallationsForAllUsers = Effect.fn(
				"PluginInstallationRepository.provisionSystemInstallationsForAllUsers",
			)(function* () {
				yield* database.run((db) => db.execute(provisionSystemInstallations(null, "installing")));
			});

			const listPendingLifecycle = Effect.fn("PluginInstallationRepository.listPendingLifecycle")(
				function* (limit: number) {
					const rows = yield* database.run((db) =>
						db
							.select({
								id: schema.pluginInstallation.id,
								activationId: schema.plugin.activationId,
							})
							.from(schema.pluginInstallation)
							.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginInstallation.pluginId))
							.where(
								and(
									eq(schema.plugin.status, "active"),
									eq(schema.pluginInstallation.health, "installing"),
									isNull(schema.pluginInstallation.uninstalledAt),
								),
							)
							.orderBy(asc(schema.pluginInstallation.createdAt), asc(schema.pluginInstallation.id))
							.limit(limit),
					);
					return rows.map(({ id, activationId }) => ({ activationId, installationId: id }));
				},
			);

			const listPrivateInstallations = Effect.fn(
				"PluginInstallationRepository.listPrivateInstallations",
			)(function* () {
				const rows = yield* database.run((db) =>
					db
						.select(privateInstallation)
						.from(schema.pluginInstallation)
						.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginInstallation.pluginId))
						.innerJoin(
							schema.pluginRevision,
							eq(schema.pluginRevision.id, schema.plugin.activeRevisionId),
						)
						.where(
							and(
								isNotNull(schema.plugin.ownerId),
								eq(schema.plugin.status, "active"),
								isNull(schema.pluginInstallation.uninstalledAt),
							),
						)
						.orderBy(asc(schema.pluginInstallation.userId), asc(schema.plugin.slug)),
				);
				return rows satisfies ReadonlyArray<PluginPrivateInstallationRow>;
			});

			const findUserSettings = Effect.fn(function* (userId: UserId, id: string) {
				const [row] = yield* database.run((db) =>
					db
						.select({
							slug: schema.plugin.slug,
							installation: schema.pluginInstallation,
							manifest: schema.pluginRevision.manifest,
						})
						.from(schema.pluginInstallation)
						.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginInstallation.pluginId))
						.innerJoin(
							schema.pluginRevision,
							eq(schema.pluginRevision.id, schema.plugin.activeRevisionId),
						)
						.where(
							and(
								eq(schema.pluginInstallation.id, id),
								eq(schema.pluginInstallation.userId, userId),
								isNull(schema.pluginInstallation.uninstalledAt),
								eq(schema.plugin.status, "active"),
							),
						)
						.limit(1),
				);
				return row;
			});
			const saveUserSettings = Effect.fn(function* (
				userId: UserId,
				id: string,
				userSettings: typeof schema.pluginInstallation.$inferSelect.userSettings,
			) {
				yield* database.run((db) =>
					db
						.update(schema.pluginInstallation)
						.set({ userSettings })
						.where(
							and(
								eq(schema.pluginInstallation.id, id),
								eq(schema.pluginInstallation.userId, userId),
								isNull(schema.pluginInstallation.uninstalledAt),
							),
						),
				);
			});

			return {
				create,
				remove,
				findById,
				listForUser,
				updateState,
				upsertState,
				updateHealth,
				findUserSettings,
				saveUserSettings,
				setHomeSavedView,
				listSystemForUser,
				findHomeSavedView,
				listHydratedForUser,
				findByUserAndPlugin,
				listPendingLifecycle,
				listPrivateInstallations,
				updateHealthForActivation,
				clearHomeSavedViewReferences,
				refreshClientConfigsForPlugin,
				provisionSystemInstallationsForUser,
				provisionSystemInstallationsForAllUsers,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(PluginConfigRevisions.layer),
	);
}
