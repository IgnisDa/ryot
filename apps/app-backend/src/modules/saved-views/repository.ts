import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Effect } from "effect";

import { buildDefaultQueryDefinition, buildDisplayConfig } from "#lib/builtins/view-helpers";
import { CurrentDb, dbEffect, isUniqueConstraintError } from "#lib/db";
import * as schema from "#lib/db/schema/tables";
import { DbError, conflict } from "#lib/errors";
import { slugify } from "#lib/slug";

import type { ListedSavedView } from "./schemas";

type SavedViewRow = typeof schema.savedView.$inferSelect;

type CreateSavedViewInput = {
	readonly slug: string;
	readonly name: string;
	readonly icon: string;
	readonly userId: string;
	readonly isBuiltin: boolean;
	readonly accentColor: string;
	readonly trackerId: string | null | undefined;
	readonly queryDefinition: (typeof schema.savedView.$inferSelect)["queryDefinition"];
	readonly displayConfiguration: (typeof schema.savedView.$inferSelect)["displayConfiguration"];
};

type UpdateSavedViewData = {
	readonly icon: string;
	readonly name: string;
	readonly trackerId?: string;
	readonly isDisabled: boolean;
	readonly accentColor: string;
	readonly queryDefinition: (typeof schema.savedView.$inferSelect)["queryDefinition"];
	readonly displayConfiguration: (typeof schema.savedView.$inferSelect)["displayConfiguration"];
};

const savedViewUserSlugConstraint = "saved_view_user_slug_unique";

const normalizeQueryDefinition = (
	queryDefinition: SavedViewRow["queryDefinition"],
): ListedSavedView["queryDefinition"] => ({
	mode: "entities",
	sort: queryDefinition.sort,
	scope: [...queryDefinition.scope],
	filter: queryDefinition.filter ?? null,
	eventJoins: [...queryDefinition.eventJoins],
	computedFields: [...queryDefinition.computedFields],
	relationshipJoins: [...(queryDefinition.relationshipJoins ?? [])],
});

const toListedSavedView = (row: SavedViewRow) => ({
	id: row.id,
	slug: row.slug,
	name: row.name,
	icon: row.icon,
	trackerId: row.trackerId,
	sortOrder: row.sortOrder,
	isBuiltin: row.isBuiltin,
	isDisabled: row.isDisabled,
	accentColor: row.accentColor,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	displayConfiguration: row.displayConfiguration,
	queryDefinition: normalizeQueryDefinition(row.queryDefinition),
});

const withSavedViewScope = (trackerId?: string) =>
	trackerId ? eq(schema.savedView.trackerId, trackerId) : isNull(schema.savedView.trackerId);

export class SavedViewsRepository extends Effect.Service<SavedViewsRepository>()(
	"SavedViewsRepository",
	{
		sync: () => ({
			listByUser: Effect.fn("SavedViewsRepository.listByUser")(function* (
				userId: string,
				input: { trackerId?: string; includeDisabled: boolean },
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
			}),
			findBySlug: Effect.fn("SavedViewsRepository.findBySlug")(function* (
				userId: string,
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
			}),
			create: Effect.fn("SavedViewsRepository.create")(function* (
				userId: string,
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
							trackerId: input.trackerId ?? null,
							queryDefinition: input.queryDefinition,
							sortOrder: (orderRow?.maxSortOrder ?? -1) + 1,
							displayConfiguration: input.displayConfiguration,
						})
						.returning(),
				).pipe(
					Effect.mapError((error) =>
						isUniqueConstraintError(savedViewUserSlugConstraint)(error)
							? new DbError({ message: "A saved view with this name already exists" })
							: error,
					),
				);

				if (!row) {
					return yield* new DbError({ message: "Saved view insert returned no row" });
				}

				return toListedSavedView(row);
			}),
			createDefaultViewForSchema: Effect.fn("SavedViewsRepository.createDefaultViewForSchema")(
				function* (input: {
					icon: string;
					userId: string;
					trackerId: string;
					accentColor: string;
					entitySchemaSlug: string;
					entitySchemaName: string;
				}) {
					const db = yield* CurrentDb;
					const name = `All ${input.entitySchemaName}s`;
					const slug = slugify(`all ${input.entitySchemaSlug}`);

					yield* dbEffect(() =>
						db.insert(schema.savedView).values({
							slug,
							name,
							isBuiltin: true,
							icon: input.icon,
							userId: input.userId,
							trackerId: input.trackerId,
							accentColor: input.accentColor,
							displayConfiguration: buildDisplayConfig(input.entitySchemaSlug),
							queryDefinition: buildDefaultQueryDefinition([input.entitySchemaSlug]),
						}),
					).pipe(
						Effect.mapError((error) =>
							isUniqueConstraintError(savedViewUserSlugConstraint)(error)
								? conflict("Entity schema default saved view already exists")
								: error,
						),
					);
				},
			),
			updateBySlug: Effect.fn("SavedViewsRepository.updateBySlug")(function* (
				userId: string,
				viewSlug: string,
				data: UpdateSavedViewData,
				currentTrackerId: string | null,
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
							queryDefinition: data.queryDefinition,
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
			}),
			updateDisabledBySlug: Effect.fn("SavedViewsRepository.updateDisabledBySlug")(function* (
				userId: string,
				viewSlug: string,
				isDisabled: boolean,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.update(schema.savedView)
						.set({ isDisabled })
						.where(and(eq(schema.savedView.slug, viewSlug), eq(schema.savedView.userId, userId)))
						.returning(),
				);

				return row ? toListedSavedView(row) : null;
			}),
			deleteBySlug: Effect.fn("SavedViewsRepository.deleteBySlug")(function* (
				userId: string,
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
			}),
			countBySlugs: Effect.fn("SavedViewsRepository.countBySlugs")(function* (
				userId: string,
				viewSlugs: ReadonlyArray<string>,
				trackerId?: string,
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
			}),
			listSlugsInOrder: Effect.fn("SavedViewsRepository.listSlugsInOrder")(function* (
				userId: string,
				trackerId?: string,
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
			}),
			persistOrder: Effect.fn("SavedViewsRepository.persistOrder")(function* (
				userId: string,
				trackerId: string | undefined,
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
			}),
		}),
	},
) {}

const getNextSortOrder = Effect.fn(function* (userId: string, trackerId: string | null) {
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
