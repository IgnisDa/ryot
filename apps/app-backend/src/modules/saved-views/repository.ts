import { DbError, conflict } from "@ryot/contract/errors";
import type { UserId } from "@ryot/contract/schema/brands";
import { SavedViewId, TrackerId } from "@ryot/contract/schema/brands";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect, isUniqueConstraintError } from "#lib/infrastructure/db/service";

type SavedViewRow = typeof schema.savedView.$inferSelect;

type CreateSavedViewInput = {
	readonly slug: string;
	readonly name: string;
	readonly icon: string;
	readonly userId: UserId;
	readonly isBuiltin: boolean;
	readonly accentColor: string;
	readonly trackerId: TrackerId | null | undefined;
	readonly queryDocument: (typeof schema.savedView.$inferSelect)["queryDocument"];
	readonly displayConfiguration: (typeof schema.savedView.$inferSelect)["displayConfiguration"];
};

type UpdateSavedViewData = {
	readonly icon: string;
	readonly name: string;
	readonly isDisabled: boolean;
	readonly accentColor: string;
	readonly trackerId?: TrackerId;
	readonly queryDocument: (typeof schema.savedView.$inferSelect)["queryDocument"];
	readonly displayConfiguration: (typeof schema.savedView.$inferSelect)["displayConfiguration"];
};

const savedViewUserSlugConstraint = "saved_view_user_slug_unique";

const toListedSavedView = (row: SavedViewRow) => ({
	slug: row.slug,
	name: row.name,
	icon: row.icon,
	sortOrder: row.sortOrder,
	isBuiltin: row.isBuiltin,
	isDisabled: row.isDisabled,
	accentColor: row.accentColor,
	id: SavedViewId.make(row.id),
	queryDocument: row.queryDocument,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	displayConfiguration: row.displayConfiguration,
	trackerId: row.trackerId === null ? null : TrackerId.make(row.trackerId),
});

const withSavedViewScope = (trackerId?: TrackerId) =>
	trackerId ? eq(schema.savedView.trackerId, trackerId) : isNull(schema.savedView.trackerId);

export class SavedViewsRepository extends Effect.Service<SavedViewsRepository>()(
	"SavedViewsRepository",
	{
		sync: () => {
			const listByUser = Effect.fn("SavedViewsRepository.listByUser")(function* (
				userId: UserId,
				input: { trackerId?: TrackerId; includeDisabled: boolean },
			) {
				const db = yield* CurrentDb;
				const clauses = [eq(schema.savedView.userId, userId)];

				if (!input.includeDisabled) {
					clauses.push(eq(schema.savedView.isDisabled, false));
				}

				if (input.trackerId) {
					clauses.push(eq(schema.savedView.trackerId, input.trackerId));
				}

				const rows = yield* dbEffect(() =>
					db
						.select()
						.from(schema.savedView)
						.where(and(...clauses))
						.orderBy(
							asc(schema.savedView.trackerId),
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
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select()
						.from(schema.savedView)
						.where(and(eq(schema.savedView.userId, userId), eq(schema.savedView.slug, viewSlug)))
						.limit(1),
				);

				return row ? toListedSavedView(row) : null;
			});

			const create = Effect.fn("SavedViewsRepository.create")(function* (
				userId: UserId,
				input: CreateSavedViewInput,
			) {
				const db = yield* CurrentDb;
				const [orderRow] = yield* dbEffect(() =>
					db
						.select({
							maxSortOrder: sql<number>`coalesce(max(${schema.savedView.sortOrder}), -1)`,
						})
						.from(schema.savedView)
						.where(
							and(
								eq(schema.savedView.userId, userId),
								withSavedViewScope(input.trackerId ?? undefined),
							),
						),
				);

				const [row] = yield* dbEffect(() =>
					db
						.insert(schema.savedView)
						.values({
							userId,
							slug: input.slug,
							name: input.name,
							icon: input.icon,
							isBuiltin: input.isBuiltin,
							accentColor: input.accentColor,
							queryDocument: input.queryDocument,
							trackerId: input.trackerId ?? null,
							sortOrder: (orderRow?.maxSortOrder ?? -1) + 1,
							displayConfiguration: input.displayConfiguration,
						})
						.returning(),
				).pipe(
					Effect.mapError((error) =>
						isUniqueConstraintError(savedViewUserSlugConstraint)(error)
							? conflict("A saved view with this name already exists")
							: error,
					),
				);

				if (!row) {
					return yield* new DbError({ message: "Saved view insert returned no row" });
				}

				return toListedSavedView(row);
			});

			const updateBySlug = Effect.fn("SavedViewsRepository.updateBySlug")(function* (
				userId: UserId,
				viewSlug: string,
				data: UpdateSavedViewData,
				currentTrackerId: TrackerId | null,
			) {
				const db = yield* CurrentDb;
				const nextTrackerId = data.trackerId ?? null;
				const sortOrder =
					currentTrackerId === nextTrackerId
						? undefined
						: yield* getNextSortOrder(userId, nextTrackerId);

				const [row] = yield* dbEffect(() =>
					db
						.update(schema.savedView)
						.set({
							icon: data.icon,
							name: data.name,
							trackerId: nextTrackerId,
							isDisabled: data.isDisabled,
							accentColor: data.accentColor,
							queryDocument: data.queryDocument,
							displayConfiguration: data.displayConfiguration,
							...(sortOrder === undefined ? {} : { sortOrder }),
						})
						.where(
							and(
								eq(schema.savedView.slug, viewSlug),
								eq(schema.savedView.userId, userId),
								eq(schema.savedView.isBuiltin, false),
							),
						)
						.returning(),
				);

				return row ? toListedSavedView(row) : null;
			});

			const updateDisabledBySlug = Effect.fn("SavedViewsRepository.updateDisabledBySlug")(
				function* (userId: UserId, viewSlug: string, isDisabled: boolean) {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.update(schema.savedView)
							.set({ isDisabled })
							.where(and(eq(schema.savedView.slug, viewSlug), eq(schema.savedView.userId, userId)))
							.returning(),
					);

					return row ? toListedSavedView(row) : null;
				},
			);

			const deleteBySlug = Effect.fn("SavedViewsRepository.deleteBySlug")(function* (
				userId: UserId,
				viewSlug: string,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.delete(schema.savedView)
						.where(
							and(
								eq(schema.savedView.slug, viewSlug),
								eq(schema.savedView.userId, userId),
								eq(schema.savedView.isBuiltin, false),
							),
						)
						.returning(),
				);

				return row ? toListedSavedView(row) : null;
			});

			const countBySlugs = Effect.fn("SavedViewsRepository.countBySlugs")(function* (
				userId: UserId,
				viewSlugs: ReadonlyArray<string>,
				trackerId?: TrackerId,
			) {
				if (viewSlugs.length === 0) {
					return 0;
				}

				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.select({ slug: schema.savedView.slug })
						.from(schema.savedView)
						.where(
							and(
								eq(schema.savedView.userId, userId),
								inArray(schema.savedView.slug, [...viewSlugs]),
								withSavedViewScope(trackerId),
							),
						),
				);

				return rows.length;
			});

			const listSlugsInOrder = Effect.fn("SavedViewsRepository.listSlugsInOrder")(function* (
				userId: UserId,
				trackerId?: TrackerId,
			) {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.select({ viewSlug: schema.savedView.slug })
						.from(schema.savedView)
						.where(and(eq(schema.savedView.userId, userId), withSavedViewScope(trackerId)))
						.orderBy(asc(schema.savedView.sortOrder), asc(schema.savedView.createdAt)),
				);

				return rows.map((row) => row.viewSlug);
			});

			const persistOrder = Effect.fn("SavedViewsRepository.persistOrder")(function* (
				userId: UserId,
				trackerId: TrackerId | undefined,
				viewSlugs: ReadonlyArray<string>,
			) {
				if (viewSlugs.length === 0) {
					return [];
				}

				const db = yield* CurrentDb;

				for (const [index, viewSlug] of viewSlugs.entries()) {
					yield* dbEffect(() =>
						db
							.update(schema.savedView)
							.set({ sortOrder: index })
							.where(
								and(
									eq(schema.savedView.slug, viewSlug),
									eq(schema.savedView.userId, userId),
									withSavedViewScope(trackerId),
								),
							),
					);
				}

				return viewSlugs;
			});

			return {
				listByUser,
				findBySlug,
				create,
				updateBySlug,
				updateDisabledBySlug,
				deleteBySlug,
				countBySlugs,
				listSlugsInOrder,
				persistOrder,
			};
		},
	},
) {}

const getNextSortOrder = Effect.fn(function* (userId: UserId, trackerId: TrackerId | null) {
	const db = yield* CurrentDb;
	const [orderRow] = yield* dbEffect(() =>
		db
			.select({
				maxSortOrder: sql<number>`coalesce(max(${schema.savedView.sortOrder}), -1)`,
			})
			.from(schema.savedView)
			.where(and(eq(schema.savedView.userId, userId), withSavedViewScope(trackerId ?? undefined))),
	);

	return (orderRow?.maxSortOrder ?? -1) + 1;
});
