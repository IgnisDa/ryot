import type { ListedSavedView } from "@ryot-app/contract/modules/saved-views/schemas";
import { PluginSlug, SavedViewId, type UserId } from "@ryot-app/contract/schema/brands";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

type SavedViewRow = typeof schema.savedView.$inferSelect;
type ListedSavedViewRow = typeof schema.userSavedViewEffective.$inferSelect;

type RestoreCustomSavedViewInput = Omit<
	SavedViewRow,
	"userId" | "revision" | "pluginInstallationId"
> & { readonly userId: UserId; readonly pluginInstallationId?: string | null | undefined };

type CreateSavedViewInput = {
	readonly slug: string;
	readonly name: string;
	readonly icon: string;
	readonly userId: UserId;
	readonly pluginInstallationId?: string | null | undefined;
	readonly dataSources?: (typeof schema.savedView.$inferSelect)["dataSources"];
	readonly renderer: (typeof schema.savedView.$inferSelect)["renderer"];
	readonly settings: (typeof schema.savedView.$inferSelect)["settings"];
};

type UpdateSavedViewData = {
	readonly icon: string;
	readonly name: string;
	readonly isDisabled: boolean;
	readonly sortOrder?: number | undefined;
	readonly pluginInstallationId: string | null;
	readonly renderer: (typeof schema.savedView.$inferSelect)["renderer"];
	readonly settings: (typeof schema.savedView.$inferSelect)["settings"];
	readonly dataSources?: (typeof schema.savedView.$inferSelect)["dataSources"];
};

const toListedSavedView = (row: ListedSavedViewRow): ListedSavedView => {
	const base = {
		slug: row.slug,
		name: row.name,
		icon: row.icon,
		renderer: row.renderer,
		settings: row.settings,
		sortOrder: row.sortOrder,
		isDisabled: row.isDisabled,
		id: SavedViewId.make(row.id),
		dataSources: row.dataSources,
		pluginSlug: row.pluginSlug === null ? null : PluginSlug.make(row.pluginSlug),
	};
	if (row.isBuiltin) {
		return { ...base, isBuiltin: true, createdAt: null, updatedAt: null };
	}
	if (row.createdAt === null || row.updatedAt === null) {
		throw new Error("Custom saved view has no creation or update timestamp");
	}
	return {
		...base,
		isBuiltin: false,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
};

const withSavedViewScope = (pluginInstallationId?: string) =>
	pluginInstallationId
		? eq(schema.savedView.pluginInstallationId, pluginInstallationId)
		: isNull(schema.savedView.pluginInstallationId);

export class SavedViewsRepository extends Context.Service<SavedViewsRepository>()(
	"SavedViewsRepository",
	{
		make: Effect.sync(() => {
			const hasCustomInstallationReferences = Effect.fn(
				"SavedViewsRepository.hasCustomInstallationReferences",
			)(function* (userId: UserId, pluginInstallationId: string) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select({ id: schema.savedView.id })
						.from(schema.savedView)
						.where(
							and(
								eq(schema.savedView.userId, userId),
								eq(schema.savedView.pluginInstallationId, pluginInstallationId),
							),
						)
						.limit(1),
				);
				return row !== undefined;
			});

			const listForBackup = Effect.fn("SavedViewsRepository.listForBackup")(function* (
				userId: UserId,
			) {
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.userSavedViewEffective)
						.where(eq(schema.userSavedViewEffective.userId, userId))
						.orderBy(asc(schema.userSavedViewEffective.id)),
				);
				return rows.map((row) =>
					Object.assign(toListedSavedView(row), { pluginInstallationId: row.pluginInstallationId }),
				);
			});

			const restoreCustomView = Effect.fn("SavedViewsRepository.restoreCustomView")(function* (
				input: RestoreCustomSavedViewInput,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db.insert(schema.savedView).values(input).returning({ slug: schema.savedView.slug }),
				);
				return row ? yield* findBySlug(input.userId, row.slug) : null;
			});

			const listByUser = Effect.fn("SavedViewsRepository.listByUser")(function* (
				userId: UserId,
				input: { pluginInstallationId?: string | undefined; includeDisabled: boolean },
			) {
				const db = yield* Database;
				const clauses = [eq(schema.userSavedViewEffective.userId, userId)];

				if (!input.includeDisabled) {
					clauses.push(eq(schema.userSavedViewEffective.isDisabled, false));
				}

				if (input.pluginInstallationId) {
					clauses.push(
						eq(schema.userSavedViewEffective.pluginInstallationId, input.pluginInstallationId),
					);
				}

				const rows = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.userSavedViewEffective)
						.where(and(...clauses))
						.orderBy(
							asc(schema.userSavedViewEffective.pluginSlug),
							asc(schema.userSavedViewEffective.sortOrder),
							asc(schema.userSavedViewEffective.slug),
						),
				);

				return rows.map(toListedSavedView);
			});

			const findBySlug = Effect.fn("SavedViewsRepository.findBySlug")(function* (
				userId: UserId,
				viewSlug: string,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.userSavedViewEffective)
						.where(
							and(
								eq(schema.userSavedViewEffective.userId, userId),
								eq(schema.userSavedViewEffective.slug, viewSlug),
							),
						)
						.limit(1),
				);

				return row
					? Object.assign(toListedSavedView(row), {
							pluginId: row.pluginId,
							pluginInstallationId: row.pluginInstallationId,
						})
					: null;
			});

			const lockBySlug = Effect.fn("SavedViewsRepository.lockBySlug")(function* (
				userId: UserId,
				viewSlug: string,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select({ id: schema.savedView.id })
						.from(schema.savedView)
						.where(and(eq(schema.savedView.userId, userId), eq(schema.savedView.slug, viewSlug)))
						.for("update", { of: schema.savedView })
						.limit(1),
				);

				return row ? yield* findBySlug(userId, viewSlug) : null;
			});

			const create = Effect.fn("SavedViewsRepository.create")(function* (
				userId: UserId,
				input: CreateSavedViewInput,
			) {
				const db = yield* Database;
				const [orderRow] = yield* mapDatabaseErrors(
					db
						.select({ maxSortOrder: sql<number>`coalesce(max(${schema.savedView.sortOrder}), -1)` })
						.from(schema.savedView)
						.where(
							and(
								eq(schema.savedView.userId, userId),
								withSavedViewScope(input.pluginInstallationId ?? undefined),
							),
						),
				);

				const rows = yield* mapDatabaseErrors(
					db
						.insert(schema.savedView)
						.values({
							userId,
							slug: input.slug,
							name: input.name,
							icon: input.icon,
							renderer: input.renderer,
							settings: input.settings,
							dataSources: input.dataSources,
							sortOrder: (orderRow?.maxSortOrder ?? -1) + 1,
							pluginInstallationId: input.pluginInstallationId ?? null,
						})
						.onConflictDoNothing({ target: [schema.savedView.userId, schema.savedView.slug] })
						.returning({ id: schema.savedView.id }),
				);

				return rows[0] ? { id: SavedViewId.make(rows[0].id) } : null;
			});

			const updateBySlug = Effect.fn("SavedViewsRepository.updateBySlug")(function* (
				userId: UserId,
				viewSlug: string,
				data: UpdateSavedViewData,
				currentPluginInstallationId: string | null,
			) {
				const db = yield* Database;
				let sortOrder = data.sortOrder;
				if (sortOrder === undefined && currentPluginInstallationId !== data.pluginInstallationId) {
					sortOrder = yield* getNextSortOrder(userId, data.pluginInstallationId);
				}

				const [row] = yield* mapDatabaseErrors(
					db
						.update(schema.savedView)
						.set({
							icon: data.icon,
							name: data.name,
							renderer: data.renderer,
							settings: data.settings,
							isDisabled: data.isDisabled,
							dataSources: data.dataSources,
							revision: sql`${schema.savedView.revision} + 1`,
							pluginInstallationId: data.pluginInstallationId,
							...(sortOrder === undefined ? {} : { sortOrder }),
						})
						.where(and(eq(schema.savedView.slug, viewSlug), eq(schema.savedView.userId, userId)))
						.returning({ id: schema.savedView.id }),
				);

				return row ? { id: SavedViewId.make(row.id) } : null;
			});

			const setBuiltinState = Effect.fn("SavedViewsRepository.setBuiltinState")(function* (
				userId: UserId,
				viewSlug: string,
				isDisabled: boolean,
				sortOrder: number,
			) {
				const db = yield* Database;
				const current = yield* findBySlug(userId, viewSlug);
				if (!current?.isBuiltin) {
					return null;
				}
				if (current.isDisabled === isDisabled && current.sortOrder === sortOrder) {
					return current;
				}
				const [definition] = yield* mapDatabaseErrors(
					db
						.select({ sortOrder: schema.userSavedView.sortOrder })
						.from(schema.userSavedView)
						.where(
							and(eq(schema.userSavedView.userId, userId), eq(schema.userSavedView.slug, viewSlug)),
						)
						.limit(1),
				);
				if (!definition) {
					return null;
				}
				if (!isDisabled && sortOrder === definition.sortOrder) {
					yield* mapDatabaseErrors(
						db
							.delete(schema.savedViewOverride)
							.where(
								and(
									eq(schema.savedViewOverride.userId, userId),
									eq(schema.savedViewOverride.slug, viewSlug),
								),
							),
					);
					return yield* findBySlug(userId, viewSlug);
				}
				yield* mapDatabaseErrors(
					db
						.insert(schema.savedViewOverride)
						.values({ userId, sortOrder, isDisabled, slug: viewSlug, pluginId: current.pluginId })
						.onConflictDoUpdate({
							target: [schema.savedViewOverride.userId, schema.savedViewOverride.slug],
							set: {
								sortOrder,
								isDisabled,
								pluginId: current.pluginId,
								revision: sql`${schema.savedViewOverride.revision} + 1`,
							},
						}),
				);
				return yield* findBySlug(userId, viewSlug);
			});

			const reorderBySlugs = Effect.fn("SavedViewsRepository.reorderBySlugs")(function* (
				userId: UserId,
				pluginInstallationId: string | null,
				viewSlugs: ReadonlyArray<string>,
			) {
				const db = yield* Database;
				let updated = 0;
				for (const [sortOrder, slug] of viewSlugs.entries()) {
					const view = yield* findBySlug(userId, slug);
					if (!view || view.pluginInstallationId !== pluginInstallationId) {
						continue;
					}
					if (view.isBuiltin) {
						if (yield* setBuiltinState(userId, slug, view.isDisabled, sortOrder)) {
							updated++;
						}
					} else {
						if (view.sortOrder === sortOrder) {
							updated++;
							continue;
						}
						const [row] = yield* mapDatabaseErrors(
							db
								.update(schema.savedView)
								.set({ sortOrder, revision: sql`${schema.savedView.revision} + 1` })
								.where(and(eq(schema.savedView.userId, userId), eq(schema.savedView.slug, slug)))
								.returning({ slug: schema.savedView.slug }),
						);
						if (row) {
							updated++;
						}
					}
				}
				return updated;
			});

			const deleteBySlug = Effect.fn("SavedViewsRepository.deleteBySlug")(function* (
				userId: UserId,
				viewSlug: string,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.delete(schema.savedView)
						.where(and(eq(schema.savedView.slug, viewSlug), eq(schema.savedView.userId, userId)))
						.returning({ id: schema.savedView.id }),
				);

				return row ? { id: SavedViewId.make(row.id) } : null;
			});

			return {
				create,
				findBySlug,
				lockBySlug,
				listByUser,
				updateBySlug,
				deleteBySlug,
				listForBackup,
				reorderBySlugs,
				setBuiltinState,
				restoreCustomView,
				hasCustomInstallationReferences,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

const getNextSortOrder = Effect.fn(function* (userId: UserId, pluginInstallationId: string | null) {
	const db = yield* Database;
	const [orderRow] = yield* mapDatabaseErrors(
		db
			.select({
				maxSortOrder: sql<number>`coalesce(max(${schema.userSavedViewEffective.sortOrder}), -1)`,
			})
			.from(schema.userSavedViewEffective)
			.where(
				and(
					eq(schema.userSavedViewEffective.userId, userId),
					pluginInstallationId
						? eq(schema.userSavedViewEffective.pluginInstallationId, pluginInstallationId)
						: isNull(schema.userSavedViewEffective.pluginInstallationId),
				),
			),
	);

	return (orderRow?.maxSortOrder ?? -1) + 1;
});
