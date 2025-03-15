import { and, asc, eq } from "drizzle-orm";
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
	queryDefinition: row.queryDefinition as SavedViewQueryDefinition,
	displayConfiguration: row.displayConfiguration as DisplayConfiguration,
});

export const listSavedViewsForUser = async (input: {
	userId: string;
	trackerId?: string;
}) => {
	const whereClauses = [eq(savedView.userId, input.userId)];

	if (input.trackerId) {
		whereClauses.push(eq(savedView.trackerId, input.trackerId));
	}

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

	if (!foundView) {
		return undefined;
	}

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

	await database.insert(savedView).values(
		input.views.map((view) => ({
			icon: view.icon,
			name: view.name,
			userId: input.userId,
			trackerId: view.trackerId,
			isBuiltin: view.isBuiltin,
			accentColor: view.accentColor,
			queryDefinition: view.queryDefinition,
			displayConfiguration: view.displayConfiguration,
		})),
	);
};

export const updateSavedViewByIdForUser = async (input: {
	userId: string;
	viewId: string;
	data: UpdateSavedViewBody;
}) => {
	const [updatedView] = await db
		.update(savedView)
		.set({
			icon: input.data.icon,
			name: input.data.name,
			trackerId: input.data.trackerId,
			isDisabled: input.data.isDisabled,
			accentColor: input.data.accentColor,
			queryDefinition: input.data.queryDefinition,
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
