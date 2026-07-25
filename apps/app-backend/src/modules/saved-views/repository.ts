import { DbError } from "@ryot/contract/errors";
import {
	EntitySchemaSlug,
	PluginSlug,
	SavedViewId,
	type UserId,
} from "@ryot/contract/schema/brands";
import { and, asc, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

type SavedViewRow = typeof schema.savedView.$inferSelect;
type ListedSavedViewRow = SavedViewRow & { readonly pluginSlug: string | null };

const savedViewPluginSlug = sql<string | null>`(
	select ${schema.plugin.slug}
	from ${schema.pluginInstallation}
	inner join ${schema.plugin} on ${schema.plugin.id} = ${schema.pluginInstallation.pluginId}
	where ${schema.pluginInstallation.id} = ${schema.savedView.pluginInstallationId}
)`;
const savedViewSelection = {
	...getTableColumns(schema.savedView),
	pluginSlug: savedViewPluginSlug,
};

type RestoreCustomSavedViewInput = Omit<
	SavedViewRow,
	"entitySchemaPluginId" | "isBuiltin" | "pluginInstallationId" | "userId"
> & {
	readonly userId: UserId;
	readonly entitySchemaPluginId?: string | null | undefined;
	readonly pluginInstallationId?: string | null | undefined;
};

type CreateSavedViewInput = {
	readonly slug: string;
	readonly name: string;
	readonly icon: string;
	readonly userId: UserId;
	readonly entitySchemaSlug: EntitySchemaSlug | null;
	readonly pluginInstallationId?: string | null | undefined;
	readonly entitySchemaPluginId?: string | null | undefined;
	readonly layouts: (typeof schema.savedView.$inferSelect)["layouts"];
};

type BuiltinSavedViewInput = Omit<CreateSavedViewInput, "userId"> & {
	readonly sortOrder: number;
};

type UpdateSavedViewData = {
	readonly icon: string;
	readonly name: string;
	readonly isDisabled: boolean;
	readonly sortOrder?: number | undefined;
	readonly pluginInstallationId: string | null;
	readonly entitySchemaPluginId: string | null;
	readonly entitySchemaSlug: EntitySchemaSlug | null;
	readonly layouts: (typeof schema.savedView.$inferSelect)["layouts"];
};

const toListedSavedView = (row: ListedSavedViewRow) => ({
	slug: row.slug,
	name: row.name,
	icon: row.icon,
	layouts: row.layouts,
	isBuiltin: row.isBuiltin,
	sortOrder: row.sortOrder,
	isDisabled: row.isDisabled,
	id: SavedViewId.make(row.id),
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	pluginSlug: row.pluginSlug === null ? null : PluginSlug.make(row.pluginSlug),
	entitySchemaSlug:
		row.entitySchemaSlug === null ? null : EntitySchemaSlug.make(row.entitySchemaSlug),
});

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
								eq(schema.savedView.isBuiltin, false),
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
						.select(savedViewSelection)
						.from(schema.savedView)
						.where(eq(schema.savedView.userId, userId))
						.orderBy(asc(schema.savedView.id)),
				);
				return rows.map((row) =>
					Object.assign(toListedSavedView(row), {
						pluginInstallationId: row.pluginInstallationId,
						entitySchemaPluginId: row.entitySchemaPluginId,
					}),
				);
			});

			const restoreCustomView = Effect.fn("SavedViewsRepository.restoreCustomView")(function* (
				input: RestoreCustomSavedViewInput,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.insert(schema.savedView)
						.values({ ...input, isBuiltin: false })
						.returning(savedViewSelection),
				);
				return row
					? Object.assign(toListedSavedView(row), {
							pluginInstallationId: row.pluginInstallationId,
						})
					: null;
			});

			const listByUser = Effect.fn("SavedViewsRepository.listByUser")(function* (
				userId: UserId,
				input: { pluginInstallationId?: string | undefined; includeDisabled: boolean },
			) {
				const db = yield* Database;
				const clauses = [eq(schema.savedView.userId, userId)];

				if (!input.includeDisabled) {
					clauses.push(eq(schema.savedView.isDisabled, false));
				}

				if (input.pluginInstallationId) {
					clauses.push(eq(schema.savedView.pluginInstallationId, input.pluginInstallationId));
				}

				const rows = yield* mapDatabaseErrors(
					db
						.select(savedViewSelection)
						.from(schema.savedView)
						.where(and(...clauses))
						.orderBy(
							asc(savedViewPluginSlug),
							asc(schema.savedView.sortOrder),
							asc(schema.savedView.createdAt),
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
						.select(savedViewSelection)
						.from(schema.savedView)
						.where(and(eq(schema.savedView.userId, userId), eq(schema.savedView.slug, viewSlug)))
						.limit(1),
				);

				return row
					? Object.assign(toListedSavedView(row), {
							pluginInstallationId: row.pluginInstallationId,
						})
					: null;
			});

			const create = Effect.fn("SavedViewsRepository.create")(function* (
				userId: UserId,
				input: CreateSavedViewInput,
			) {
				const db = yield* Database;
				const [orderRow] = yield* mapDatabaseErrors(
					db
						.select({
							maxSortOrder: sql<number>`coalesce(max(${schema.savedView.sortOrder}), -1)`,
						})
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
							layouts: input.layouts,
							entitySchemaSlug: input.entitySchemaSlug,
							sortOrder: (orderRow?.maxSortOrder ?? -1) + 1,
							pluginInstallationId: input.pluginInstallationId ?? null,
							entitySchemaPluginId: input.entitySchemaPluginId ?? null,
						})
						.onConflictDoNothing({
							target: [schema.savedView.userId, schema.savedView.slug],
						})
						.returning(savedViewSelection),
				);

				return rows[0] ? toListedSavedView(rows[0]) : null;
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
							layouts: data.layouts,
							isDisabled: data.isDisabled,
							pluginInstallationId: data.pluginInstallationId,
							entitySchemaSlug: data.entitySchemaSlug,
							entitySchemaPluginId: data.entitySchemaPluginId,
							...(sortOrder === undefined ? {} : { sortOrder }),
						})
						.where(and(eq(schema.savedView.slug, viewSlug), eq(schema.savedView.userId, userId)))
						.returning(savedViewSelection),
				);

				return row ? toListedSavedView(row) : null;
			});

			const updateBuiltinStateBySlug = Effect.fn("SavedViewsRepository.updateBuiltinStateBySlug")(
				function* (userId: UserId, viewSlug: string, isDisabled: boolean, sortOrder: number) {
					const db = yield* Database;
					const [row] = yield* mapDatabaseErrors(
						db
							.update(schema.savedView)
							.set({ isDisabled, sortOrder })
							.where(
								and(
									eq(schema.savedView.slug, viewSlug),
									eq(schema.savedView.userId, userId),
									eq(schema.savedView.isBuiltin, true),
								),
							)
							.returning(savedViewSelection),
					);

					return row ? toListedSavedView(row) : null;
				},
			);

			const deleteBySlug = Effect.fn("SavedViewsRepository.deleteBySlug")(function* (
				userId: UserId,
				viewSlug: string,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.delete(schema.savedView)
						.where(and(eq(schema.savedView.slug, viewSlug), eq(schema.savedView.userId, userId)))
						.returning(savedViewSelection),
				);

				return row ? toListedSavedView(row) : null;
			});

			const ensureBuiltinViews = Effect.fn("SavedViewsRepository.ensureBuiltinViews")(function* (
				userId: UserId,
				views: ReadonlyArray<BuiltinSavedViewInput>,
			) {
				const db = yield* Database;
				const existing = yield* mapDatabaseErrors(
					db.select().from(schema.savedView).where(eq(schema.savedView.userId, userId)),
				);
				const existingBySlug = new Map(existing.map((view) => [view.slug, view]));
				for (const view of views) {
					const current = existingBySlug.get(view.slug);
					if (
						current &&
						(!current.isBuiltin ||
							current.pluginInstallationId !== (view.pluginInstallationId ?? null))
					) {
						return yield* new DbError({
							message: `Saved view slug is owned by another view: ${view.slug}`,
						});
					}
				}

				const desiredSlugs = new Set(views.map(({ slug }) => slug));
				const obsoleteIds = existing
					.filter(({ isBuiltin, slug }) => isBuiltin && !desiredSlugs.has(slug))
					.map(({ id }) => id);
				if (obsoleteIds.length > 0) {
					yield* mapDatabaseErrors(
						db.delete(schema.savedView).where(inArray(schema.savedView.id, obsoleteIds)),
					);
				}

				yield* Effect.forEach(
					views,
					(view) => {
						const current = existingBySlug.get(view.slug);
						const values = {
							name: view.name,
							icon: view.icon,
							layouts: view.layouts,
							entitySchemaSlug: view.entitySchemaSlug,
							pluginInstallationId: view.pluginInstallationId ?? null,
							entitySchemaPluginId: view.entitySchemaPluginId ?? null,
						};
						return current
							? mapDatabaseErrors(
									db
										.update(schema.savedView)
										.set(values)
										.where(eq(schema.savedView.id, current.id)),
								)
							: mapDatabaseErrors(
									db.insert(schema.savedView).values({
										...values,
										userId,
										slug: view.slug,
										isBuiltin: true,
										sortOrder: view.sortOrder,
									}),
								);
					},
					{ discard: true },
				);
				return yield* Effect.void;
			});

			const restoreBuiltinViews = Effect.fn("SavedViewsRepository.restoreBuiltinViews")(function* (
				userId: UserId,
				views: ReadonlyArray<BuiltinSavedViewInput>,
			) {
				const db = yield* Database;
				yield* Effect.forEach(
					views,
					(view) =>
						mapDatabaseErrors(
							db.insert(schema.savedView).values({ ...view, userId, isBuiltin: true }),
						),
					{ discard: true },
				);
			});

			const deleteGeneratedByInstallation = Effect.fn(
				"SavedViewsRepository.deleteGeneratedByInstallation",
			)(function* (pluginInstallationId: string) {
				const db = yield* Database;
				yield* mapDatabaseErrors(
					db
						.delete(schema.savedView)
						.where(
							and(
								eq(schema.savedView.isBuiltin, true),
								eq(schema.savedView.pluginInstallationId, pluginInstallationId),
							),
						),
				);
			});

			return {
				create,
				findBySlug,
				listByUser,
				hasCustomInstallationReferences,
				updateBySlug,
				deleteBySlug,
				listForBackup,
				restoreCustomView,
				ensureBuiltinViews,
				restoreBuiltinViews,
				updateBuiltinStateBySlug,
				deleteGeneratedByInstallation,
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
				maxSortOrder: sql<number>`coalesce(max(${schema.savedView.sortOrder}), -1)`,
			})
			.from(schema.savedView)
			.where(
				and(
					eq(schema.savedView.userId, userId),
					withSavedViewScope(pluginInstallationId ?? undefined),
				),
			),
	);

	return (orderRow?.maxSortOrder ?? -1) + 1;
});
