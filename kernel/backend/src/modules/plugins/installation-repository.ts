import { DbError } from "@ryot-app/contract/errors";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

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

type RestoreInstallationInput = Omit<
	PluginInstallationRow,
	| "userId"
	| "healthReason"
	| "homeSavedViewId"
	| "activeConfigRevisionId"
	| "uninstalledAt"
	| "configSchema"
> & {
	readonly userId: UserId;
	readonly preserveExistingConfig: boolean;
	readonly configuredSecretPaths?: ReadonlyArray<string>;
	readonly allowMissingRequiredSecrets?: boolean;
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
	manifest: schema.pluginRevision.manifest,
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
	health: schema.pluginInstallation.health,
	pluginId: schema.pluginInstallation.pluginId,
	sortOrder: schema.pluginInstallation.sortOrder,
	createdAt: schema.pluginInstallation.createdAt,
	updatedAt: schema.pluginInstallation.updatedAt,
	isDisabled: schema.pluginInstallation.isDisabled,
	healthReason: schema.pluginInstallation.healthReason,
	uninstalledAt: schema.pluginInstallation.uninstalledAt,
	homeSavedViewId: schema.pluginInstallation.homeSavedViewId,
	activeConfigRevisionId: schema.pluginInstallation.activeConfigRevisionId,
};

export class PluginInstallationRepository extends Context.Service<PluginInstallationRepository>()(
	"PluginInstallationRepository",
	{
		make: Effect.gen(function* () {
			const configs = yield* PluginConfigRevisions;
			const hydrate = Effect.fn(function* <T extends StoredInstallationRow>(row: T) {
				if (!row.activeConfigRevisionId) {
					return { ...row, config: {} };
				}
				const db = yield* Database;
				const [revision] = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.pluginConfigRevision)
						.where(eq(schema.pluginConfigRevision.id, row.activeConfigRevisionId))
						.limit(1),
				);
				if (
					!revision ||
					revision.ownerUserId !== row.userId ||
					revision.pluginInstallationId !== row.id
				) {
					return yield* new DbError({ message: "Invalid installation configuration ownership" });
				}
				const [packageRevision] = yield* mapDatabaseErrors(
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
				const db = yield* Database;
				yield* mapDatabaseErrors(
					db
						.select({ id: schema.plugin.id })
						.from(schema.plugin)
						.where(and(eq(schema.plugin.id, pluginId), eq(schema.plugin.scope, "user")))
						.for("share"),
				);
			});
			const lockProjectionInputs = Effect.fn(function* (pluginId: string) {
				yield* configs.lock(pluginId);
				yield* lockPluginRevision(pluginId);
			});
			const projectLockedClientConfig = Effect.fn(function* (id: string) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select({
							scope: schema.plugin.scope,
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
					row.scope === "system" || row.installation.uninstalledAt !== null || !activeSchema
						? { config: {}, configuredSecrets: [] }
						: yield* hydrate(row.installation).pipe(
								Effect.map((hydrated: PluginInstallationRow) =>
									redactPluginConfig(activeSchema, hydrated.config, hydrated.configSchema),
								),
							);
				yield* mapDatabaseErrors(
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
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select({ pluginId: schema.pluginInstallation.pluginId })
						.from(schema.pluginInstallation)
						.where(eq(schema.pluginInstallation.id, id))
						.limit(1),
				);
				return row?.pluginId ?? null;
			});
			const refreshClientConfig = Effect.fn(function* (row: StoredInstallationRow) {
				const db = yield* Database;
				yield* lockProjectionInputs(row.pluginId);
				yield* mapDatabaseErrors(
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
				const db = yield* Database;
				yield* lockPluginRevision(pluginId);
				const rows = yield* mapDatabaseErrors(
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
				const db = yield* Database;
				yield* configs.lock(row.pluginId);
				const [plugin] = yield* mapDatabaseErrors(
					db.select().from(schema.plugin).where(eq(schema.plugin.id, row.pluginId)).limit(1),
				);
				if (!plugin?.activeRevisionId) {
					return yield* new DbError({ message: "Plugin package revision is unavailable" });
				}
				if (plugin.scope === "system") {
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
				yield* mapDatabaseErrors(
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
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
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
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
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
					const db = yield* Database;
					const rows = yield* mapDatabaseErrors(
						db
							.select(installationState)
							.from(schema.pluginInstallation)
							.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginInstallation.pluginId))
							.where(
								and(
									eq(schema.plugin.scope, "system"),
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
									isNull(schema.pluginInstallation.uninstalledAt),
								),
							)
							.limit(1),
					);
					return row ? yield* hydrate(row) : null;
				},
			);

			const lockHomeSavedView = Effect.fn("PluginInstallationRepository.lockHomeSavedView")(
				function* (userId: UserId, savedViewId: string) {
					const db = yield* Database;
					const [row] = yield* mapDatabaseErrors(
						db
							.select({
								view: {
									renderer: schema.savedView.renderer,
									isDisabled: schema.savedView.isDisabled,
								},
								renderer: {
									userId: schema.clientRenderer.userId,
									publishedHash: schema.clientRenderer.publishedHash,
									publishedRevision: schema.clientRenderer.publishedRevision,
									publishedDefinition: schema.clientRenderer.publishedDefinition,
								},
							})
							.from(schema.savedView)
							.leftJoin(
								schema.clientRenderer,
								eq(schema.savedView.clientRendererId, schema.clientRenderer.id),
							)
							.where(and(eq(schema.savedView.id, savedViewId), eq(schema.savedView.userId, userId)))
							.for("update", { of: schema.savedView })
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
				yield* lockProjectionInputs(input.pluginId);
				const { config, ...values } = input;
				const [row] = yield* mapDatabaseErrors(
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
					const db = yield* Database;
					yield* mapDatabaseErrors(
						db
							.update(schema.pluginInstallation)
							.set({ health: input.health, healthReason: input.healthReason })
							.where(eq(schema.pluginInstallation.id, input.id)),
					);
				},
			);

			const setHomeSavedView = Effect.fn("PluginInstallationRepository.setHomeSavedView")(
				function* (userId: UserId, id: string, homeSavedViewId: string | null) {
					const db = yield* Database;
					const [row] = yield* mapDatabaseErrors(
						db
							.update(schema.pluginInstallation)
							.set({ homeSavedViewId })
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
			)(function* (userId: UserId, savedViewId: string) {
				const db = yield* Database;
				yield* mapDatabaseErrors(
					db
						.update(schema.pluginInstallation)
						.set({ homeSavedViewId: null })
						.where(
							and(
								eq(schema.pluginInstallation.userId, userId),
								eq(schema.pluginInstallation.homeSavedViewId, savedViewId),
							),
						),
				);
			});

			const upsertState = Effect.fn("PluginInstallationRepository.upsertState")(function* (input: {
				userId: UserId;
				pluginId: string;
				sortOrder: number;
				isDisabled: boolean;
				config: Record<string, unknown>;
				health: PluginInstallationHealth;
			}) {
				const db = yield* Database;
				yield* lockProjectionInputs(input.pluginId);
				const { config, ...values } = input;
				const [row] = yield* mapDatabaseErrors(
					db
						.insert(schema.pluginInstallation)
						.values({ ...values, healthReason: null })
						.onConflictDoUpdate({
							target: [schema.pluginInstallation.userId, schema.pluginInstallation.pluginId],
							set: {
								healthReason: null,
								uninstalledAt: null,
								health: input.health,
								sortOrder: input.sortOrder,
								isDisabled: input.isDisabled,
							},
						})
						.returning(),
				);
				return row ? yield* saveConfig(row, config) : undefined;
			});

			const updateState = Effect.fn("PluginInstallationRepository.updateState")(function* (input: {
				id: string;
				sortOrder: number;
				isDisabled: boolean;
				config: Record<string, unknown>;
			}) {
				const db = yield* Database;
				const pluginId = yield* installationPluginId(input.id);
				if (pluginId !== null) {
					yield* lockProjectionInputs(pluginId);
				}
				const [row] = yield* mapDatabaseErrors(
					db
						.update(schema.pluginInstallation)
						.set({ sortOrder: input.sortOrder, isDisabled: input.isDisabled })
						.where(eq(schema.pluginInstallation.id, input.id))
						.returning(),
				);
				return row ? yield* saveConfig(row, input.config) : undefined;
			});

			const remove = Effect.fn("PluginInstallationRepository.remove")(function* (id: string) {
				const db = yield* Database;
				yield* mapDatabaseErrors(
					db
						.update(schema.pluginInstallation)
						.set({
							clientConfig: {},
							isDisabled: true,
							configuredSecretPaths: [],
							uninstalledAt: sql`now()`,
						})
						.where(eq(schema.pluginInstallation.id, id)),
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
									isNull(schema.pluginInstallation.uninstalledAt),
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
						.innerJoin(
							schema.pluginRevision,
							eq(schema.pluginRevision.id, schema.plugin.activeRevisionId),
						)
						.where(
							and(
								eq(schema.plugin.scope, "user"),
								eq(schema.plugin.status, "active"),
								isNull(schema.pluginInstallation.uninstalledAt),
							),
						)
						.orderBy(asc(schema.pluginInstallation.userId), asc(schema.plugin.slug)),
				);
				return rows satisfies ReadonlyArray<PluginPrivateInstallationRow>;
			});

			const restore = Effect.fn("PluginInstallationRepository.restore")(function* (
				input: RestoreInstallationInput,
			) {
				const db = yield* Database;
				yield* lockProjectionInputs(input.pluginId);
				const {
					config,
					configuredSecretPaths,
					preserveExistingConfig,
					allowMissingRequiredSecrets,
					...values
				} = input;
				const [row] = yield* mapDatabaseErrors(
					db
						.insert(schema.pluginInstallation)
						.values(values)
						.onConflictDoUpdate({
							target: [schema.pluginInstallation.userId, schema.pluginInstallation.pluginId],
							set: {
								healthReason: null,
								uninstalledAt: null,
								health: input.health,
								sortOrder: input.sortOrder,
								createdAt: input.createdAt,
								updatedAt: input.updatedAt,
								isDisabled: input.isDisabled,
							},
						})
						.returning(),
				);
				if (!row) {
					return undefined;
				}
				if (preserveExistingConfig && row.activeConfigRevisionId) {
					yield* refreshClientConfig(row);
					return yield* hydrate(row);
				}
				return yield* saveConfig(row, config, configuredSecretPaths, allowMissingRequiredSecrets);
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
								healthReason: null,
								health: input.health,
								updatedAt: input.updatedAt,
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
				setHomeSavedView,
				activateRestored,
				listSystemForUser,
				lockHomeSavedView,
				listHydratedForUser,
				findByUserAndPlugin,
				listPendingLifecycle,
				listPrivateInstallations,
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
