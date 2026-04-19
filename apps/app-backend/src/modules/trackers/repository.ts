import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { CurrentDb, dbEffect, isUniqueConstraintError, schema } from "../../lib/db";
import type { Conflict } from "../../lib/errors";
import { DbError, conflict } from "../../lib/errors";
import type { ListedTracker } from "./schemas";

type TrackerRow = typeof schema.tracker.$inferSelect;

type OwnedTracker = {
	readonly id: string;
	readonly slug: string;
	readonly name: string;
	readonly icon: string;
	readonly accentColor: string;
	readonly description: string | null;
};

type CreateTrackerInput = {
	readonly slug: string;
	readonly name: string;
	readonly icon: string;
	readonly accentColor: string;
	readonly description?: string | null;
};

type UpdateTrackerInput = {
	readonly slug: string;
	readonly name: string;
	readonly icon: string;
	readonly userId: string;
	readonly trackerId: string;
	readonly isDisabled: boolean;
	readonly accentColor: string;
	readonly description: string | null;
};

const trackerUserSlugConstraint = "tracker_user_slug_unique";

const toListedTracker = (row: TrackerRow): ListedTracker => ({
	id: row.id,
	slug: row.slug,
	name: row.name,
	icon: row.icon,
	config: row.config,
	isBuiltin: row.isBuiltin,
	sortOrder: row.sortOrder,
	isDisabled: row.isDisabled,
	accentColor: row.accentColor,
	description: row.description,
});

const toOwnedTracker = (row: TrackerRow): OwnedTracker => ({
	id: row.id,
	slug: row.slug,
	name: row.name,
	icon: row.icon,
	accentColor: row.accentColor,
	description: row.description,
});

export class TrackersRepository extends Context.Tag("TrackersRepository")<
	TrackersRepository,
	{
		readonly listByUser: (
			userId: string,
			includeDisabled: boolean,
		) => Effect.Effect<ReadonlyArray<ListedTracker>, DbError, CurrentDb>;
		readonly create: (
			userId: string,
			input: CreateTrackerInput,
		) => Effect.Effect<ListedTracker, Conflict | DbError, CurrentDb>;
		readonly findBySlug: (
			userId: string,
			slug: string,
		) => Effect.Effect<{ readonly id: string } | null, DbError, CurrentDb>;
		readonly getOwnedById: (
			userId: string,
			trackerId: string,
		) => Effect.Effect<OwnedTracker | null, DbError, CurrentDb>;
		readonly updateOwned: (
			input: UpdateTrackerInput,
		) => Effect.Effect<ListedTracker | null, DbError, CurrentDb>;
		readonly countOwnedByIds: (
			userId: string,
			trackerIds: ReadonlyArray<string>,
		) => Effect.Effect<number, DbError, CurrentDb>;
		readonly listIdsInOrder: (
			userId: string,
		) => Effect.Effect<ReadonlyArray<string>, DbError, CurrentDb>;
		readonly persistOrder: (
			userId: string,
			trackerIds: ReadonlyArray<string>,
		) => Effect.Effect<ReadonlyArray<string>, DbError, CurrentDb>;
	}
>() {}

export const TrackersRepositoryLive = Layer.succeed(TrackersRepository, {
	listByUser: (userId, includeDisabled) =>
		Effect.gen(function* () {
			const db = yield* CurrentDb;
			const clauses = [eq(schema.tracker.userId, userId)];

			if (!includeDisabled) {
				clauses.push(eq(schema.tracker.isDisabled, false));
			}

			const rows = yield* dbEffect(() =>
				db
					.select()
					.from(schema.tracker)
					.where(and(...clauses))
					.orderBy(
						asc(schema.tracker.isDisabled),
						asc(schema.tracker.sortOrder),
						asc(schema.tracker.name),
					),
			);

			return rows.map(toListedTracker);
		}),
	create: (userId, input) =>
		Effect.gen(function* () {
			const db = yield* CurrentDb;
			const [orderRow] = yield* dbEffect(() =>
				db
					.select({
						maxSortOrder: sql<number>`coalesce(max(${schema.tracker.sortOrder}), -1)`,
					})
					.from(schema.tracker)
					.where(eq(schema.tracker.userId, userId)),
			);

			const [row] = yield* dbEffect(() =>
				db
					.insert(schema.tracker)
					.values({
						userId,
						isBuiltin: false,
						slug: input.slug,
						name: input.name,
						icon: input.icon,
						description: input.description,
						accentColor: input.accentColor,
						sortOrder: (orderRow?.maxSortOrder ?? -1) + 1,
					})
					.returning(),
			).pipe(
				Effect.mapError((error) =>
					isUniqueConstraintError(trackerUserSlugConstraint)(error)
						? conflict("Tracker slug already exists")
						: error,
				),
			);

			if (!row) {
				return yield* new DbError({ message: "Tracker insert returned no row" });
			}

			return toListedTracker(row);
		}),
	findBySlug: (userId, slug) =>
		Effect.gen(function* () {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.select({ id: schema.tracker.id })
					.from(schema.tracker)
					.where(and(eq(schema.tracker.userId, userId), eq(schema.tracker.slug, slug)))
					.limit(1),
			);

			return row ?? null;
		}),
	getOwnedById: (userId, trackerId) =>
		Effect.gen(function* () {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.select()
					.from(schema.tracker)
					.where(and(eq(schema.tracker.id, trackerId), eq(schema.tracker.userId, userId)))
					.limit(1),
			);

			return row ? toOwnedTracker(row) : null;
		}),
	updateOwned: (input) =>
		Effect.gen(function* () {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.update(schema.tracker)
					.set({
						slug: input.slug,
						name: input.name,
						icon: input.icon,
						isDisabled: input.isDisabled,
						description: input.description,
						accentColor: input.accentColor,
					})
					.where(
						and(eq(schema.tracker.id, input.trackerId), eq(schema.tracker.userId, input.userId)),
					)
					.returning(),
			);

			return row ? toListedTracker(row) : null;
		}),
	countOwnedByIds: (userId, trackerIds) =>
		trackerIds.length === 0
			? Effect.succeed(0)
			: Effect.gen(function* () {
					const db = yield* CurrentDb;
					const rows = yield* dbEffect(() =>
						db
							.select({ id: schema.tracker.id })
							.from(schema.tracker)
							.where(
								and(eq(schema.tracker.userId, userId), inArray(schema.tracker.id, [...trackerIds])),
							),
					);

					return rows.length;
				}),
	listIdsInOrder: (userId) =>
		Effect.gen(function* () {
			const db = yield* CurrentDb;
			const rows = yield* dbEffect(() =>
				db
					.select({ trackerId: schema.tracker.id })
					.from(schema.tracker)
					.where(eq(schema.tracker.userId, userId))
					.orderBy(asc(schema.tracker.sortOrder), asc(schema.tracker.createdAt)),
			);

			return rows.map((row) => row.trackerId);
		}),
	persistOrder: (userId, trackerIds) =>
		trackerIds.length === 0
			? Effect.succeed([])
			: Effect.gen(function* () {
					const db = yield* CurrentDb;

					for (const [index, trackerId] of trackerIds.entries()) {
						yield* dbEffect(() =>
							db
								.update(schema.tracker)
								.set({ sortOrder: index })
								.where(and(eq(schema.tracker.id, trackerId), eq(schema.tracker.userId, userId))),
						);
					}

					return trackerIds;
				}),
});
