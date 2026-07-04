import { type EntitySchemaId, TrackerId, type UserId } from "@ryot/contract/schema/brands";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

type TrackerRow = typeof schema.tracker.$inferSelect;

type CreateTrackerInput = {
	readonly slug: string;
	readonly name: string;
	readonly icon: string;
	readonly accentColor: string;
	readonly isBuiltin?: boolean | undefined;
	readonly description?: string | null | undefined;
};

type UpdateTrackerData = {
	readonly slug: string;
	readonly name: string;
	readonly icon: string;
	readonly userId: UserId;
	readonly trackerId: TrackerId;
	readonly isDisabled: boolean;
	readonly accentColor: string;
	readonly description: string | null;
	readonly sortOrder?: number | undefined;
};

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

			const rows = yield* dbEffect(() =>
				db
					.insert(schema.tracker)
					.values({
						userId,
						isBuiltin: input.isBuiltin ?? false,
						slug: input.slug,
						name: input.name,
						icon: input.icon,
						description: input.description,
						accentColor: input.accentColor,
						sortOrder: (orderRow?.maxSortOrder ?? -1) + 1,
					})
					.onConflictDoNothing({
						target: [schema.tracker.userId, schema.tracker.slug],
					})
					.returning(),
			);

			return rows[0] ? toListedTracker(rows[0]) : null;
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

		const existsById = Effect.fn("TrackersRepository.existsById")(function* (trackerId: TrackerId) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.select({ id: schema.tracker.id })
					.from(schema.tracker)
					.where(eq(schema.tracker.id, trackerId))
					.limit(1),
			);

			return Boolean(row);
		});

		const updateOwned = Effect.fn("TrackersRepository.updateOwned")(function* (
			input: UpdateTrackerData,
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
						...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
					})
					.where(
						and(eq(schema.tracker.id, input.trackerId), eq(schema.tracker.userId, input.userId)),
					)
					.returning(),
			);

			return row ? toListedTracker(row) : null;
		});

		const listInOrder = Effect.fn("TrackersRepository.listInOrder")(function* (userId: UserId) {
			const db = yield* CurrentDb;
			const scope = eq(schema.tracker.userId, userId);
			yield* dbEffect(() =>
				db.select({ id: schema.tracker.id }).from(schema.tracker).where(scope).for("update"),
			);

			const rows = yield* dbEffect(() =>
				db
					.select()
					.from(schema.tracker)
					.where(scope)
					.orderBy(asc(schema.tracker.sortOrder), asc(schema.tracker.createdAt)),
			);

			return rows.map(toListedTracker);
		});

		const linkEntitySchema = Effect.fn("TrackersRepository.linkEntitySchema")(function* (input: {
			trackerId: TrackerId;
			entitySchemaId: EntitySchemaId;
		}) {
			const db = yield* CurrentDb;
			yield* dbEffect(() =>
				db
					.insert(schema.trackerEntitySchema)
					.values({ trackerId: input.trackerId, entitySchemaId: input.entitySchemaId })
					.onConflictDoNothing({
						target: [
							schema.trackerEntitySchema.trackerId,
							schema.trackerEntitySchema.entitySchemaId,
						],
					}),
			);

			return TrackerId.make(input.trackerId);
		});

		return {
			listByUser,
			create,
			existsById,
			findBySlug,
			getOwnedById,
			updateOwned,
			listInOrder,
			countOwnedByIds,
			linkEntitySchema,
		};
	},
}) {}
