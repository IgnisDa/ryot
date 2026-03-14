import { and, asc, eq } from "drizzle-orm";
import { type DbClient, db } from "~/lib/db";
import { savedView } from "~/lib/db/schema";
import type {
	CreateSavedViewBody,
	ListedSavedView,
	SavedViewQueryDefinition,
} from "./schemas";

type SavedViewCreateInput = CreateSavedViewBody & {
	isBuiltin: boolean;
	userId: string;
};

type SavedViewRow = Omit<ListedSavedView, "queryDefinition"> & {
	queryDefinition: unknown;
};

const savedViewSelection = {
	id: savedView.id,
	icon: savedView.icon,
	name: savedView.name,
	trackerId: savedView.trackerId,
	isBuiltin: savedView.isBuiltin,
	accentColor: savedView.accentColor,
	queryDefinition: savedView.queryDefinition,
};

const toSavedView = (row: SavedViewRow): ListedSavedView => ({
	...row,
	queryDefinition: row.queryDefinition as SavedViewQueryDefinition,
});

export const listSavedViewsForUser = async (input: {
	userId: string;
	trackerId?: string;
}) => {
	const whereClauses = [eq(savedView.userId, input.userId)];

	if (input.trackerId)
		whereClauses.push(eq(savedView.trackerId, input.trackerId));

	const rows = await db
		.select(savedViewSelection)
		.from(savedView)
		.where(and(...whereClauses))
		.orderBy(asc(savedView.name), asc(savedView.createdAt));

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

	if (!foundView) return undefined;

	return toSavedView(foundView);
};

export const createSavedViewForUser = async (input: SavedViewCreateInput) => {
	const [createdView] = await db
		.insert(savedView)
		.values({
			icon: input.icon,
			name: input.name,
			userId: input.userId,
			trackerId: input.trackerId,
			isBuiltin: input.isBuiltin,
			accentColor: input.accentColor,
			queryDefinition: input.queryDefinition,
		})
		.returning(savedViewSelection);

	if (!createdView) throw new Error("Could not persist saved view");

	return toSavedView(createdView);
};

export const createSavedViewsForUser = async (input: {
	userId: string;
	database?: DbClient;
	views: Array<Omit<SavedViewCreateInput, "userId">>;
}) => {
	if (!input.views.length) return;

	const database = input.database ?? db;

	await database.insert(savedView).values(
		input.views.map((view) => ({
			icon: view.icon,
			name: view.name,
			userId: input.userId,
			trackerId: view.trackerId,
			isBuiltin: view.isBuiltin,
			accentColor: view.accentColor,
			queryDefinition: view.queryDefinition,
		})),
	);
};

export const deleteSavedViewByIdForUser = async (input: {
	userId: string;
	viewId: string;
}) => {
	const [deletedView] = await db
		.delete(savedView)
		.where(
			and(eq(savedView.userId, input.userId), eq(savedView.id, input.viewId)),
		)
		.returning(savedViewSelection);

	if (!deletedView) return undefined;

	return toSavedView(deletedView);
};
