import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/db/schema/tables/combined";
import { CurrentDb, dbEffect, isUniqueConstraintError } from "#lib/db/service";
import { DbError, conflict } from "#lib/errors";
import { type EntitySchemaId, TrackerId, type UserId } from "#lib/schema/brands";

type TrackerRow = typeof schema.tracker.$inferSelect;

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
	readonly userId: UserId;
	readonly trackerId: TrackerId;
	readonly isDisabled: boolean;
	readonly accentColor: string;
	readonly description: string | null;
};

const trackerUserSlugConstraint = "tracker_user_slug_unique";

const toListedTracker = (row: TrackerRow) => ({
	id: TrackerId.make(row.id),
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

const toOwnedTracker = (row: TrackerRow) => ({
	id: TrackerId.make(row.id),
	slug: row.slug,
	name: row.name,
	icon: row.icon,
	isBuiltin: row.isBuiltin,
	accentColor: row.accentColor,
	description: row.description,
});

const countOwnedByIds = (userId: UserId, trackerIds: ReadonlyArray<TrackerId>) =>
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
			});

const persistOrder = (userId: UserId, trackerIds: ReadonlyArray<TrackerId>) =>
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
			});

export class TrackersRepository extends Effect.Service<TrackersRepository>()("TrackersRepository", {
	sync: () => {
		const listByUser = Effect.fn("TrackersRepository.listByUser")(function* (
			userId: UserId,
			includeDisabled: boolean,
		) {
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
		});

		const create = Effect.fn("TrackersRepository.create")(function* (
			userId: UserId,
			input: CreateTrackerInput,
		) {
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
		});

		const findBySlug = Effect.fn("TrackersRepository.findBySlug")(function* (
			userId: UserId,
			slug: string,
		) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.select({ id: schema.tracker.id })
					.from(schema.tracker)
					.where(and(eq(schema.tracker.userId, userId), eq(schema.tracker.slug, slug)))
					.limit(1),
			);

			return row ? { id: TrackerId.make(row.id) } : null;
		});

		const getOwnedById = Effect.fn("TrackersRepository.getOwnedById")(function* (
			userId: UserId,
			trackerId: TrackerId,
		) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.select()
					.from(schema.tracker)
					.where(and(eq(schema.tracker.id, trackerId), eq(schema.tracker.userId, userId)))
					.limit(1),
			);

			return row ? toOwnedTracker(row) : null;
		});

		const updateOwned = Effect.fn("TrackersRepository.updateOwned")(function* (
			input: UpdateTrackerInput,
		) {
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
		});

		const listIdsInOrder = Effect.fn("TrackersRepository.listIdsInOrder")(function* (
			userId: UserId,
		) {
			const db = yield* CurrentDb;
			const rows = yield* dbEffect(() =>
				db
					.select({ trackerId: schema.tracker.id })
					.from(schema.tracker)
					.where(eq(schema.tracker.userId, userId))
					.orderBy(asc(schema.tracker.sortOrder), asc(schema.tracker.createdAt)),
			);

			return rows.map((row) => TrackerId.make(row.trackerId));
		});

		const linkEntitySchema = Effect.fn("TrackersRepository.linkEntitySchema")(function* (input: {
			trackerId: TrackerId;
			entitySchemaId: EntitySchemaId;
		}) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.insert(schema.trackerEntitySchema)
					.values({ trackerId: input.trackerId, entitySchemaId: input.entitySchemaId })
					.returning({ trackerId: schema.trackerEntitySchema.trackerId }),
			);

			if (!row) {
				return yield* new DbError({
					message: "Tracker entity schema link insert returned no row",
				});
			}

			return TrackerId.make(row.trackerId);
		});

		return {
			listByUser,
			create,
			findBySlug,
			getOwnedById,
			updateOwned,
			countOwnedByIds,
			listIdsInOrder,
			persistOrder,
			linkEntitySchema,
		};
	},
}) {}
