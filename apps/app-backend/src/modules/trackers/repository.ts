import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { type DbClient, db } from "~/lib/db";
import { tracker } from "~/lib/db/schema";
import type { ListedTracker } from "./schemas";

type TrackerRow = Omit<ListedTracker, "description"> & {
	description: string | null;
};

const trackerSelection = {
	id: tracker.id,
	slug: tracker.slug,
	name: tracker.name,
	icon: tracker.icon,
	config: tracker.config,
	isBuiltin: tracker.isBuiltin,
	sortOrder: tracker.sortOrder,
	isDisabled: tracker.isDisabled,
	accentColor: tracker.accentColor,
	description: tracker.description,
};

const trackerScopeSelection = {
	id: tracker.id,
	userId: tracker.userId,
	isBuiltin: tracker.isBuiltin,
};

const ownedTrackerSelection = {
	id: tracker.id,
	slug: tracker.slug,
	name: tracker.name,
	icon: tracker.icon,
	description: tracker.description,
	accentColor: tracker.accentColor,
};

const trackerSlugSelection = {
	id: tracker.id,
	slug: tracker.slug,
};

const toListedTracker = (row: TrackerRow): ListedTracker => ({
	...row,
	description: row.description ?? null,
});

export const listTrackersByUser = async (
	userId: string,
	includeDisabled = false,
) => {
	const whereClauses = [eq(tracker.userId, userId)];

	if (!includeDisabled) {
		whereClauses.push(eq(tracker.isDisabled, false));
	}

	const rows = await db
		.select(trackerSelection)
		.from(tracker)
		.where(and(...whereClauses))
		.orderBy(
			asc(tracker.isDisabled),
			asc(tracker.sortOrder),
			asc(tracker.name),
		);

	return rows.map(toListedTracker);
};

export const getVisibleTrackerById = async (input: {
	userId: string;
	trackerId: string;
}) => {
	const foundTracker = await getTrackerScopeForUser(input);
	return foundTracker ? { id: foundTracker.id } : foundTracker;
};

export const getTrackerScopeForUser = async (input: {
	userId: string;
	trackerId: string;
}) => {
	const [foundTracker] = await db
		.select(trackerScopeSelection)
		.from(tracker)
		.where(
			and(eq(tracker.id, input.trackerId), eq(tracker.userId, input.userId)),
		)
		.limit(1);

	return foundTracker;
};

export const getTrackerBySlugForUser = async (input: {
	userId: string;
	slug: string;
	excludeTrackerId?: string;
}) => {
	const whereClauses = [
		eq(tracker.slug, input.slug),
		eq(tracker.userId, input.userId),
	];

	if (input.excludeTrackerId) {
		whereClauses.push(ne(tracker.id, input.excludeTrackerId));
	}

	const [foundTracker] = await db
		.select({ id: tracker.id })
		.from(tracker)
		.where(and(...whereClauses))
		.limit(1);

	return foundTracker;
};

export const getOwnedTrackerById = async (input: {
	userId: string;
	trackerId: string;
}) => {
	const [ownedTracker] = await db
		.select(ownedTrackerSelection)
		.from(tracker)
		.where(
			and(eq(tracker.id, input.trackerId), eq(tracker.userId, input.userId)),
		)
		.limit(1);

	return ownedTracker;
};

export const createTrackerForUser = async (input: {
	name: string;
	slug: string;
	icon: string;
	userId: string;
	accentColor: string;
	description?: string;
}) => {
	const [orderRow] = await db
		.select({
			maxSortOrder: sql<number>`coalesce(max(${tracker.sortOrder}), -1)`,
		})
		.from(tracker)
		.where(eq(tracker.userId, input.userId));

	const nextSortOrder = Number(orderRow?.maxSortOrder ?? -1) + 1;

	const [createdTracker] = await db
		.insert(tracker)
		.values({
			isBuiltin: false,
			slug: input.slug,
			name: input.name,
			icon: input.icon,
			userId: input.userId,
			sortOrder: nextSortOrder,
			accentColor: input.accentColor,
			description: input.description,
		})
		.returning(trackerSelection);

	if (!createdTracker) {
		throw new Error("Could not persist tracker");
	}

	return toListedTracker(createdTracker);
};

export const createBuiltinTrackersForUser = async (input: {
	userId: string;
	database?: DbClient;
	trackers: Array<{
		slug: string;
		icon: string;
		name: string;
		accentColor: string;
		description?: string;
	}>;
}) => {
	if (!input.trackers.length) {
		return [];
	}

	const database = input.database ?? db;

	const rows = await database
		.insert(tracker)
		.values(
			input.trackers.map((item, index) => ({
				isBuiltin: true,
				slug: item.slug,
				name: item.name,
				icon: item.icon,
				sortOrder: index,
				userId: input.userId,
				accentColor: item.accentColor,
				description: item.description,
			})),
		)
		.returning(trackerSlugSelection);

	return rows;
};

export const listUserTrackerIdsInOrder = async (userId: string) => {
	const rows = await db
		.select({ trackerId: tracker.id })
		.from(tracker)
		.where(eq(tracker.userId, userId))
		.orderBy(asc(tracker.sortOrder), asc(tracker.createdAt));

	return rows.map((row) => row.trackerId);
};

export const countVisibleTrackersByIdsForUser = async (input: {
	userId: string;
	trackerIds: string[];
}) => {
	if (!input.trackerIds.length) {
		return 0;
	}

	const rows = await db
		.select({ id: tracker.id })
		.from(tracker)
		.where(
			and(
				eq(tracker.userId, input.userId),
				inArray(tracker.id, input.trackerIds),
			),
		);

	return rows.length;
};

export const persistTrackerOrderForUser = async (input: {
	userId: string;
	trackerIds: string[];
}) => {
	await db.transaction(async (tx) => {
		for (const [index, trackerId] of input.trackerIds.entries()) {
			await tx
				.update(tracker)
				.set({ sortOrder: index })
				.where(
					and(eq(tracker.id, trackerId), eq(tracker.userId, input.userId)),
				);
		}
	});

	return input.trackerIds;
};

export const updateTrackerForUser = async (input: {
	slug: string;
	icon: string;
	name: string;
	userId: string;
	trackerId: string;
	isDisabled: boolean;
	accentColor: string;
	description: string | null;
}) => {
	const [updatedTracker] = await db
		.update(tracker)
		.set({
			slug: input.slug,
			name: input.name,
			icon: input.icon,
			isDisabled: input.isDisabled,
			description: input.description,
			accentColor: input.accentColor,
		})
		.where(
			and(eq(tracker.id, input.trackerId), eq(tracker.userId, input.userId)),
		)
		.returning(trackerSelection);

	return updatedTracker ? toListedTracker(updatedTracker) : updatedTracker;
};
