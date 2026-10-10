import { DbError } from "@ryot-app/contract/errors";
import type { SavedViewReference } from "@ryot-app/contract/modules/plugins/references";
import { UserId } from "@ryot-app/contract/schema/brands";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { PLUGIN_INGESTION_ADVISORY_LOCK_KEY } from "#lib/infrastructure/db/advisory-locks";
import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";

import { redactPluginConfig } from "./config-redaction";
import { PluginConfigRevisions } from "./config-revisions";

type StoredInstallationRow = Omit<
	typeof schema.pluginInstallation.$inferSelect,
	"clientConfig" | "configuredSecretPaths" | "ingestionRetiring"
>;
export type PluginInstallationRow = StoredInstallationRow & {
	readonly config: Record<string, unknown>;
	readonly configSchema?: (typeof schema.pluginRevision.$inferSelect)["manifest"]["configSchema"];
};

export type PluginInstallationHealth = PluginInstallationRow["health"];

type PluginRow = typeof schema.plugin.$inferSelect;

export type PluginPrivateInstallationRow = Pick<
	PluginInstallationRow,
	"userId" | "health" | "healthReason" | "incompatibilityReason" | "isInitialized"
> & {
	readonly pluginId: PluginRow["id"];
	readonly packageId: PluginRow["packageId"];
	readonly manifest: (typeof schema.pluginRevision.$inferSelect)["manifest"];
	readonly installationId: PluginInstallationRow["id"];
};

export type PluginInstallationState = StoredInstallationRow & {
	readonly packageId: PluginRow["packageId"];
	readonly pluginScope: "system" | "user";
};

export type PluginInstallationHydratedState = PluginInstallationState &
	Pick<PluginInstallationRow, "config" | "configSchema">;

const provisionSystemInstallations = (
	userId: UserId | null,
	health: PluginInstallationHealth,
) => sql`
	insert into ${schema.pluginInstallation} (id, user_id, plugin_id, health, is_initialized)
	select gen_random_uuid()::text, ${schema.user.id}, ${schema.plugin.id}, ${health},
		jsonb_array_length(${schema.pluginRevision.manifest}->'userBootstrap') = 0
	from ${schema.user}
	cross join ${schema.plugin}
	join ${schema.pluginRevision} on ${schema.pluginRevision.id} = ${schema.plugin.activeRevisionId}
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
	packageId: schema.plugin.packageId,
	manifest: schema.pluginRevision.manifest,
	userId: schema.pluginInstallation.userId,
	health: schema.pluginInstallation.health,
	installationId: schema.pluginInstallation.id,
	healthReason: schema.pluginInstallation.healthReason,
	isInitialized: schema.pluginInstallation.isInitialized,
	incompatibilityReason: schema.pluginInstallation.incompatibilityReason,
};

const installationState = {
	id: schema.pluginInstallation.id,
	packageId: schema.plugin.packageId,
	userId: schema.pluginInstallation.userId,
	health: schema.pluginInstallation.health,
	pluginId: schema.pluginInstallation.pluginId,
	isHidden: schema.pluginInstallation.isHidden,
	sortOrder: schema.pluginInstallation.sortOrder,
	createdAt: schema.pluginInstallation.createdAt,
	updatedAt: schema.pluginInstallation.updatedAt,
	userSettings: schema.pluginInstallation.userSettings,
	healthReason: schema.pluginInstallation.healthReason,
	isInitialized: schema.pluginInstallation.isInitialized,
	uninstalledAt: schema.pluginInstallation.uninstalledAt,
	homeSavedView: schema.pluginInstallation.homeSavedView,
	incompatibilityReason: schema.pluginInstallation.incompatibilityReason,
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
						.orderBy(asc(schema.pluginInstallation.sortOrder), asc(schema.plugin.packageId)),
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
							.orderBy(asc(schema.pluginInstallation.sortOrder), asc(schema.plugin.packageId)),
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
				function* (userId: UserId, reference: SavedViewReference) {
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
									reference.kind === "custom"
										? and(
												eq(schema.userSavedViewEffective.id, reference.savedViewId),
												eq(schema.userSavedViewEffective.isBuiltin, false),
											)
										: and(
												eq(schema.userSavedViewEffective.slug, reference.slug),
												eq(schema.userSavedViewEffective.isBuiltin, true),
												reference.kind === "kernel"
													? isNull(schema.userSavedViewEffective.pluginId)
													: eq(schema.userSavedViewEffective.pluginId, reference.pluginId),
											),
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
					incompatibilityReason?: PluginInstallationRow["incompatibilityReason"];
				}) {
					yield* database.run((db) =>
						db
							.update(schema.pluginInstallation)
							.set({
								health: input.health,
								healthReason: input.healthReason,
								incompatibilityReason: input.incompatibilityReason ?? null,
							})
							.where(eq(schema.pluginInstallation.id, input.id)),
					);
				},
			);
			const updateHealthForActivation = Effect.fn(
				"PluginInstallationRepository.updateHealthForActivation",
			)(function* (input: Parameters<typeof updateHealth>[0] & { activationId: string }) {
				yield* database.requireTransaction;
				yield* database.run((db) =>
					db.execute(
						sql`select pg_advisory_xact_lock_shared(hashtext(${PLUGIN_INGESTION_ADVISORY_LOCK_KEY}))`,
					),
				);
				const [updated] = yield* database.run((db) =>
					db
						.update(schema.pluginInstallation)
						.set({
							health: input.health,
							healthReason: input.healthReason,
							incompatibilityReason: input.incompatibilityReason ?? null,
							isInitialized:
								input.health === "ready" ? true : schema.pluginInstallation.isInitialized,
						})
						.where(
							and(
								eq(schema.pluginInstallation.id, input.id),
								eq(schema.pluginInstallation.health, "installing"),
								isNull(schema.pluginInstallation.uninstalledAt),
								isNull(schema.pluginInstallation.incompatibilityReason),
								sql`exists (select 1 from ${schema.plugin} where ${schema.plugin.id} = ${schema.pluginInstallation.pluginId} and ${schema.plugin.status} = 'active' and ${schema.plugin.activationId} = ${input.activationId})`,
							),
						)
						.returning({ id: schema.pluginInstallation.id }),
				);
				return updated !== undefined;
			});
			const completeSystemInitialization = Effect.fn(
				"PluginInstallationRepository.completeSystemInitialization",
			)(function* (input: {
				readonly installationId: string;
				readonly activationId: string;
				readonly userId: UserId;
			}) {
				yield* database.requireTransaction;
				yield* database.run((db) =>
					db.execute(
						sql`select pg_advisory_xact_lock_shared(hashtext(${PLUGIN_INGESTION_ADVISORY_LOCK_KEY}))`,
					),
				);
				const [updated] = yield* database.run((db) =>
					db
						.update(schema.pluginInstallation)
						.set({ health: "ready", healthReason: null, isInitialized: true })
						.where(
							and(
								eq(schema.pluginInstallation.id, input.installationId),
								eq(schema.pluginInstallation.userId, input.userId),
								sql`${schema.pluginInstallation.health} in ('ready', 'installing')`,
								isNull(schema.pluginInstallation.uninstalledAt),
								isNull(schema.pluginInstallation.incompatibilityReason),
								sql`exists (select 1 from ${schema.plugin} where ${schema.plugin.id} = ${schema.pluginInstallation.pluginId} and ${schema.plugin.ownerId} is null and ${schema.plugin.status} = 'active' and ${schema.plugin.activationId} = ${input.activationId})`,
							),
						)
						.returning({ id: schema.pluginInstallation.id }),
				);
				return updated !== undefined;
			});

			const setHomeSavedView = Effect.fn("PluginInstallationRepository.setHomeSavedView")(
				function* (userId: UserId, id: string, homeSavedView: SavedViewReference | null) {
					const [row] = yield* database.run((db) =>
						db
							.update(schema.pluginInstallation)
							.set({ homeSavedView })
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
			)(function* (userId: UserId, reference: SavedViewReference) {
				yield* database.run((db) =>
					db
						.update(schema.pluginInstallation)
						.set({ homeSavedView: null })
						.where(
							and(
								eq(schema.pluginInstallation.userId, userId),
								eq(schema.pluginInstallation.homeSavedView, reference),
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
								ingestionRetiring: false,
								isHidden: input.isHidden,
								sortOrder: input.sortOrder,
								incompatibilityReason: null,
								isInitialized: sql`case when ${schema.pluginInstallation.uninstalledAt} is not null then false else ${schema.pluginInstallation.isInitialized} end`,
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
			const beginIngestionRetirement = Effect.fn(
				"PluginInstallationRepository.beginIngestionRetirement",
			)(function* (userId: UserId, id: string) {
				yield* database.requireTransaction;
				yield* database.acquireUserWriteLock(userId);
				yield* database.run((db) =>
					db
						.update(schema.pluginInstallation)
						.set({ ingestionRetiring: true })
						.where(
							and(
								eq(schema.pluginInstallation.id, id),
								eq(schema.pluginInstallation.userId, userId),
							),
						),
				);
			});
			const assertIngestionActive = Effect.fn("PluginInstallationRepository.assertIngestionActive")(
				function* (userId: UserId, id: string) {
					yield* database.requireTransaction;
					const pluginId = yield* installationPluginId(id);
					if (pluginId !== null) {
						yield* configs.lock(pluginId);
					}
					yield* database.acquireUserWriteLock(userId);
					const [row] = yield* database.run((db) =>
						db
							.select({ id: schema.pluginInstallation.id })
							.from(schema.pluginInstallation)
							.where(
								and(
									eq(schema.pluginInstallation.id, id),
									eq(schema.pluginInstallation.userId, userId),
									eq(schema.pluginInstallation.ingestionRetiring, false),
									isNull(schema.pluginInstallation.uninstalledAt),
								),
							)
							.limit(1),
					);
					if (!row) {
						return yield* new DbError({ message: "Installation ingestion owner has retired" });
					}
					return yield* Effect.void;
				},
			);

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
						.orderBy(asc(schema.pluginInstallation.userId), asc(schema.plugin.packageId)),
				);
				return rows satisfies ReadonlyArray<PluginPrivateInstallationRow>;
			});
			const quarantinePackageIdentityConflicts = Effect.fn(
				"PluginInstallationRepository.quarantinePackageIdentityConflicts",
			)(function* (packageId: PluginRow["packageId"]) {
				yield* database.requireTransaction;
				const rows = yield* database.run((db) =>
					db
						.select({
							pluginId: schema.plugin.id,
							id: schema.pluginInstallation.id,
							userId: schema.pluginInstallation.userId,
						})
						.from(schema.pluginInstallation)
						.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginInstallation.pluginId))
						.where(
							and(
								eq(schema.plugin.packageId, packageId),
								isNotNull(schema.plugin.ownerId),
								isNull(schema.pluginInstallation.uninstalledAt),
								isNull(schema.pluginInstallation.incompatibilityReason),
							),
						)
						.orderBy(asc(schema.plugin.id), asc(schema.pluginInstallation.userId)),
				);
				for (const row of rows) {
					yield* configs.lock(row.pluginId);
					yield* database.acquireUserWriteLock(UserId.make(row.userId));
					yield* updateHealth({
						id: row.id,
						health: "incompatible",
						incompatibilityReason: "package-identity-conflict",
						healthReason: "The package identity is reserved by an active system plugin",
					});
				}
				return rows;
			});

			const findUserSettings = Effect.fn(function* (userId: UserId, id: string) {
				const [row] = yield* database.run((db) =>
					db
						.select({
							packageId: schema.plugin.packageId,
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
			const findUserSettingsForRevision = Effect.fn(function* (input: {
				userId: UserId;
				pluginId: string;
				pluginRevisionId: string;
				installationId?: string;
			}) {
				const [row] = yield* database.run((db) =>
					db
						.select({
							manifest: schema.pluginRevision.manifest,
							installationId: schema.pluginInstallation.id,
							userSettings: schema.pluginInstallation.userSettings,
						})
						.from(schema.pluginInstallation)
						.innerJoin(
							schema.pluginRevision,
							and(
								eq(schema.pluginRevision.id, input.pluginRevisionId),
								eq(schema.pluginRevision.pluginId, schema.pluginInstallation.pluginId),
							),
						)
						.where(
							and(
								eq(schema.pluginInstallation.pluginId, input.pluginId),
								eq(schema.pluginInstallation.userId, input.userId),
								isNull(schema.pluginInstallation.uninstalledAt),
								...(input.installationId
									? [eq(schema.pluginInstallation.id, input.installationId)]
									: []),
							),
						)
						.limit(1),
				);
				return row ?? null;
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
				assertIngestionActive,
				beginIngestionRetirement,
				listPrivateInstallations,
				updateHealthForActivation,
				findUserSettingsForRevision,
				completeSystemInitialization,
				clearHomeSavedViewReferences,
				refreshClientConfigsForPlugin,
				quarantinePackageIdentityConflicts,
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
