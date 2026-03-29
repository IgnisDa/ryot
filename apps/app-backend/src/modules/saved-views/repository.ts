import type { UserId } from "@ryot/contract/schema/brands";
import { PluginSlug, SavedViewId } from "@ryot/contract/schema/brands";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

type SavedViewRow = typeof schema.savedView.$inferSelect;

type CreateSavedViewInput = {
	readonly slug: string;
	readonly name: string;
	readonly icon: string;
	readonly userId: UserId;
	readonly accentColor: string;
	readonly pluginSlug: PluginSlug | null | undefined;
	readonly queryDocument: (typeof schema.savedView.$inferSelect)["queryDocument"];
	readonly displayConfiguration: (typeof schema.savedView.$inferSelect)["displayConfiguration"];
};

type UpdateSavedViewData = {
	readonly icon: string;
	readonly name: string;
	readonly isDisabled: boolean;
	readonly accentColor: string;
	readonly sortOrder?: number | undefined;
	readonly pluginSlug?: PluginSlug | undefined;
	readonly queryDocument: (typeof schema.savedView.$inferSelect)["queryDocument"];
	readonly displayConfiguration: (typeof schema.savedView.$inferSelect)["displayConfiguration"];
};

const toListedSavedView = (row: SavedViewRow) => ({
	slug: row.slug,
	name: row.name,
	icon: row.icon,
	isBuiltin: false,
	sortOrder: row.sortOrder,
	isDisabled: row.isDisabled,
	accentColor: row.accentColor,
	id: SavedViewId.make(row.id),
	queryDocument: row.queryDocument,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	displayConfiguration: row.displayConfiguration,
	pluginSlug: row.pluginSlug === null ? null : PluginSlug.make(row.pluginSlug),
});

const withSavedViewScope = (pluginSlug?: PluginSlug) =>
	pluginSlug ? eq(schema.savedView.pluginSlug, pluginSlug) : isNull(schema.savedView.pluginSlug);

export class SavedViewsRepository extends Effect.Service<SavedViewsRepository>()(
	"SavedViewsRepository",
	{
		sync: () => {
			const listByUser = Effect.fn("SavedViewsRepository.listByUser")(function* (
				userId: UserId,
				input: { pluginSlug?: PluginSlug | undefined; includeDisabled: boolean },
			) {
				const db = yield* CurrentDb;
				const clauses = [eq(schema.savedView.userId, userId)];

				if (!input.includeDisabled) {
					clauses.push(eq(schema.savedView.isDisabled, false));
				}

				if (input.pluginSlug) {
					clauses.push(eq(schema.savedView.pluginSlug, input.pluginSlug));
				}

				const rows = yield* dbEffect(() =>
					db
						.select()
						.from(schema.savedView)
						.where(and(...clauses))
						.orderBy(
							asc(schema.savedView.pluginSlug),
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
								withSavedViewScope(input.pluginSlug ?? undefined),
							),
						),
				);

				const rows = yield* dbEffect(() =>
					db
						.insert(schema.savedView)
						.values({
							userId,
							slug: input.slug,
							name: input.name,
							icon: input.icon,
							accentColor: input.accentColor,
							queryDocument: input.queryDocument,
							pluginSlug: input.pluginSlug ?? null,
							sortOrder: (orderRow?.maxSortOrder ?? -1) + 1,
							displayConfiguration: input.displayConfiguration,
						})
						.onConflictDoNothing({
							target: [schema.savedView.userId, schema.savedView.slug],
						})
						.returning(),
				);

				return rows[0] ? toListedSavedView(rows[0]) : null;
			});

			const updateBySlug = Effect.fn("SavedViewsRepository.updateBySlug")(function* (
				userId: UserId,
				viewSlug: string,
				data: UpdateSavedViewData,
				currentPluginSlug: PluginSlug | null,
			) {
				const db = yield* CurrentDb;
				const nextPluginSlug = data.pluginSlug ?? null;
				let sortOrder = data.sortOrder;
				if (sortOrder === undefined && currentPluginSlug !== nextPluginSlug) {
					sortOrder = yield* getNextSortOrder(userId, nextPluginSlug);
				}

				const [row] = yield* dbEffect(() =>
					db
						.update(schema.savedView)
						.set({
							icon: data.icon,
							name: data.name,
							pluginSlug: nextPluginSlug,
							isDisabled: data.isDisabled,
							accentColor: data.accentColor,
							queryDocument: data.queryDocument,
							displayConfiguration: data.displayConfiguration,
							...(sortOrder === undefined ? {} : { sortOrder }),
						})
						.where(and(eq(schema.savedView.slug, viewSlug), eq(schema.savedView.userId, userId)))
						.returning(),
				);

				return row ? toListedSavedView(row) : null;
			});

			const updateDisabledBySlug = Effect.fn("SavedViewsRepository.updateDisabledBySlug")(
				function* (userId: UserId, viewSlug: string, isDisabled: boolean, sortOrder?: number) {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.update(schema.savedView)
							.set({
								isDisabled,
								...(sortOrder === undefined ? {} : { sortOrder }),
							})
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
						.where(and(eq(schema.savedView.slug, viewSlug), eq(schema.savedView.userId, userId)))
						.returning(),
				);

				return row ? toListedSavedView(row) : null;
			});

			const countBySlugs = Effect.fn("SavedViewsRepository.countBySlugs")(function* (
				userId: UserId,
				viewSlugs: ReadonlyArray<string>,
				pluginSlug?: PluginSlug,
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
								withSavedViewScope(pluginSlug),
							),
						),
				);

				return rows.length;
			});

			const listInOrder = Effect.fn("SavedViewsRepository.listInOrder")(function* (
				userId: UserId,
				pluginSlug?: PluginSlug,
			) {
				const db = yield* CurrentDb;
				const scope = and(eq(schema.savedView.userId, userId), withSavedViewScope(pluginSlug));
				yield* dbEffect(() =>
					db.select({ id: schema.savedView.id }).from(schema.savedView).where(scope).for("update"),
				);

				const rows = yield* dbEffect(() =>
					db
						.select()
						.from(schema.savedView)
						.where(scope)
						.orderBy(asc(schema.savedView.sortOrder), asc(schema.savedView.createdAt)),
				);

				return rows.map(toListedSavedView);
			});

			const listBuiltinStates = Effect.fn(function* (userId: UserId) {
				const db = yield* CurrentDb;
				return yield* dbEffect(() =>
					db.select().from(schema.savedViewState).where(eq(schema.savedViewState.userId, userId)),
				);
			});

			const upsertBuiltinState = Effect.fn(function* (input: {
				userId: UserId;
				sortOrder: number;
				isDisabled: boolean;
				savedViewSlug: string;
			}) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.insert(schema.savedViewState)
						.values(input)
						.onConflictDoUpdate({
							target: [schema.savedViewState.userId, schema.savedViewState.savedViewSlug],
							set: { sortOrder: input.sortOrder, isDisabled: input.isDisabled },
						})
						.returning(),
				);
				return row;
			});

			return {
				create,
				listByUser,
				listInOrder,
				findBySlug,
				countBySlugs,
				updateBySlug,
				deleteBySlug,
				listBuiltinStates,
				upsertBuiltinState,
				updateDisabledBySlug,
			};
		},
	},
) {}

const getNextSortOrder = Effect.fn(function* (userId: UserId, pluginSlug: PluginSlug | null) {
	const db = yield* CurrentDb;
	const [orderRow] = yield* dbEffect(() =>
		db
			.select({
				maxSortOrder: sql<number>`coalesce(max(${schema.savedView.sortOrder}), -1)`,
			})
			.from(schema.savedView)
			.where(and(eq(schema.savedView.userId, userId), withSavedViewScope(pluginSlug ?? undefined))),
	);

	return (orderRow?.maxSortOrder ?? -1) + 1;
});
