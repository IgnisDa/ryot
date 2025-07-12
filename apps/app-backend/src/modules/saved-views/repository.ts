import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { type DbClient, db } from "~/lib/db";
import { savedView } from "~/lib/db/schema";
import type {
	CreateSavedViewBody,
	DisplayConfiguration,
	ListedSavedView,
	SavedViewQueryDefinition,
	UpdateSavedViewBody,
} from "./schemas";

type SavedViewCreateInput = CreateSavedViewBody & {
	userId: string;
	isBuiltin: boolean;
};

type SavedViewRow = Omit<
	ListedSavedView,
	"queryDefinition" | "displayConfiguration"
> & {
	queryDefinition: unknown;
	displayConfiguration: unknown;
};

const savedViewSelection = {
	id: savedView.id,
	icon: savedView.icon,
	name: savedView.name,
	sortOrder: savedView.sortOrder,
	trackerId: savedView.trackerId,
	isBuiltin: savedView.isBuiltin,
	createdAt: savedView.createdAt,
	updatedAt: savedView.updatedAt,
	isDisabled: savedView.isDisabled,
	accentColor: savedView.accentColor,
	queryDefinition: savedView.queryDefinition,
	displayConfiguration: savedView.displayConfiguration,
};

const toSavedView = (row: SavedViewRow): ListedSavedView => ({
	...row,
	displayConfiguration: row.displayConfiguration as DisplayConfiguration,
	queryDefinition: {
		...(row.queryDefinition as SavedViewQueryDefinition),
		eventJoins:
			(row.queryDefinition as SavedViewQueryDefinition).eventJoins ?? [],
	},
});

const withSavedViewScope = (trackerId?: string) =>
	trackerId ? eq(savedView.trackerId, trackerId) : isNull(savedView.trackerId);

const savedViewOrderPersistenceError = "Could not persist saved view order";

const getNextSavedViewSortOrderForUser = async (input: {
	userId: string;
	database: DbClient;
	trackerId?: string;
}) => {
	const [orderRow] = await input.database
		.select({
			maxSortOrder: sql<number>`coalesce(max(${savedView.sortOrder}), -1)`,
		})
		.from(savedView)
		.where(
			and(
				eq(savedView.userId, input.userId),
				withSavedViewScope(input.trackerId),
			),
		);

	return Number(orderRow?.maxSortOrder ?? -1) + 1;
};

export const listSavedViewsForUser = async (input: {
	userId: string;
	trackerId?: string;
	includeDisabled?: boolean;
}) => {
	const whereClauses = [eq(savedView.userId, input.userId)];

	if (!input.includeDisabled) {
		whereClauses.push(eq(savedView.isDisabled, false));
	}

	if (input.trackerId) {
		whereClauses.push(eq(savedView.trackerId, input.trackerId));
	}

	const rows = await db
		.select(savedViewSelection)
		.from(savedView)
		.where(and(...whereClauses))
		.orderBy(
			asc(savedView.trackerId),
			asc(savedView.sortOrder),
			asc(savedView.createdAt),
		);

	return rows.map(toSavedView);
};

export const getSavedViewByIdForUser = async (input: {
	userId: string;
	viewId: string;
}) => {
	const [foundView] = await db
		.select(savedViewSelection)
		.from(savedView)
		.where(
			and(eq(savedView.userId, input.userId), eq(savedView.id, input.viewId)),
		)
		.limit(1);

	if (!foundView) {
		return undefined;
	}

	return toSavedView(foundView);
};

export const createSavedViewForUser = async (input: SavedViewCreateInput) => {
	const sortOrder = await getNextSavedViewSortOrderForUser({
		database: db,
		userId: input.userId,
		trackerId: input.trackerId,
	});

	const [createdView] = await db
		.insert(savedView)
		.values({
			sortOrder,
			icon: input.icon,
			name: input.name,
			userId: input.userId,
			trackerId: input.trackerId,
			isBuiltin: input.isBuiltin,
			accentColor: input.accentColor,
			queryDefinition: input.queryDefinition,
			displayConfiguration: input.displayConfiguration,
		})
		.returning(savedViewSelection);

	if (!createdView) {
		throw new Error("Could not persist saved view");
	}

	return toSavedView(createdView);
};

export const createSavedViewsForUser = async (input: {
	userId: string;
	database?: DbClient;
	views: Array<Omit<SavedViewCreateInput, "userId">>;
}) => {
	if (!input.views.length) {
		return;
	}

	const database = input.database ?? db;
	const scopeOrderMap = new Map<string, number>();

	await database.insert(savedView).values(
		input.views.map((view) => {
			const scopeKey = view.trackerId ?? "__top_level__";
			const sortOrder = scopeOrderMap.get(scopeKey) ?? 0;
			scopeOrderMap.set(scopeKey, sortOrder + 1);
			return {
				sortOrder,
				icon: view.icon,
				name: view.name,
				userId: input.userId,
				trackerId: view.trackerId,
				isBuiltin: view.isBuiltin,
				accentColor: view.accentColor,
				queryDefinition: view.queryDefinition,
				displayConfiguration: view.displayConfiguration,
			};
		}),
	);
};

export const updateSavedViewByIdForUser = async (input: {
	userId: string;
	viewId: string;
	data: UpdateSavedViewBody;
	currentTrackerId: string | null;
}) => {
	const nextTrackerId = input.data.trackerId ?? null;
	const sortOrder =
		input.currentTrackerId === nextTrackerId
			? undefined
			: await getNextSavedViewSortOrderForUser({
					database: db,
					userId: input.userId,
					trackerId: input.data.trackerId,
				});

	const [updatedView] = await db
		.update(savedView)
		.set({
			icon: input.data.icon,
			name: input.data.name,
			trackerId: nextTrackerId,
			isDisabled: input.data.isDisabled,
			accentColor: input.data.accentColor,
			queryDefinition: input.data.queryDefinition,
			...(sortOrder === undefined ? {} : { sortOrder }),
			displayConfiguration: input.data.displayConfiguration,
		})
		.where(
			and(
				eq(savedView.id, input.viewId),
				eq(savedView.userId, input.userId),
				eq(savedView.isBuiltin, false),
			),
		)
		.returning(savedViewSelection);

	if (!updatedView) {
		return undefined;
	}

	return toSavedView(updatedView);
};

export const listUserSavedViewIdsInOrder = async (input: {
	userId: string;
	trackerId?: string;
}) => {
	const rows = await db
		.select({ viewId: savedView.id })
		.from(savedView)
		.where(
			and(
				eq(savedView.userId, input.userId),
				withSavedViewScope(input.trackerId),
			),
		)
		.orderBy(asc(savedView.sortOrder), asc(savedView.createdAt));

	return rows.map((row) => row.viewId);
};

export const countSavedViewsByIdsForUser = async (input: {
	userId: string;
	viewIds: string[];
	trackerId?: string;
}) => {
	if (!input.viewIds.length) {
		return 0;
	}

	const rows = await db
		.select({ id: savedView.id })
		.from(savedView)
		.where(
			and(
				eq(savedView.userId, input.userId),
				inArray(savedView.id, input.viewIds),
				withSavedViewScope(input.trackerId),
			),
		);

	return rows.length;
};

export const persistSavedViewOrderForUser = async (input: {
	userId: string;
	viewIds: string[];
	trackerId?: string;
}) => {
	try {
		return await db.transaction(async (tx) => {
			const updatedIds: string[] = [];

			for (const [index, viewId] of input.viewIds.entries()) {
				const [updatedView] = await tx
					.update(savedView)
					.set({ sortOrder: index })
					.where(
						and(
							eq(savedView.id, viewId),
							eq(savedView.userId, input.userId),
							withSavedViewScope(input.trackerId),
						),
					)
					.returning({ id: savedView.id });

				if (!updatedView) {
					throw new Error(savedViewOrderPersistenceError);
				}

				updatedIds.push(updatedView.id);
			}

			return updatedIds;
		});
	} catch (error) {
		if (
			error instanceof Error &&
			error.message === savedViewOrderPersistenceError
		) {
			return undefined;
		}

		throw error;
	}
};

export const updateSavedViewDisabledByIdForUser = async (input: {
	userId: string;
	viewId: string;
	isDisabled: boolean;
}) => {
	const [updatedView] = await db
		.update(savedView)
		.set({ isDisabled: input.isDisabled })
		.where(
			and(eq(savedView.id, input.viewId), eq(savedView.userId, input.userId)),
		)
		.returning(savedViewSelection);

	if (!updatedView) {
		return undefined;
	}

	return toSavedView(updatedView);
};

export const deleteSavedViewByIdForUser = async (input: {
	userId: string;
	viewId: string;
}) => {
	const [deletedView] = await db
		.delete(savedView)
		.where(
			and(
				eq(savedView.id, input.viewId),
				eq(savedView.userId, input.userId),
				eq(savedView.isBuiltin, false),
			),
		)
		.returning(savedViewSelection);

	if (!deletedView) {
		return undefined;
	}

	return toSavedView(deletedView);
};
