import { and, asc, eq } from "drizzle-orm";
import { type DbClient, db } from "~/lib/db";
import { savedView } from "~/lib/db/schema";
import type { SavedViewQueryDefinition } from "./schemas";

export const listSavedViewsForUser = async (input: {
	userId: string;
	facetId?: string;
}) => {
	const whereClauses = [eq(savedView.userId, input.userId)];

	if (input.facetId) whereClauses.push(eq(savedView.facetId, input.facetId));

	const rows = await db
		.select({
			id: savedView.id,
			icon: savedView.icon,
			name: savedView.name,
			facetId: savedView.facetId,
			isBuiltin: savedView.isBuiltin,
			accentColor: savedView.accentColor,
			queryDefinition: savedView.queryDefinition,
		})
		.from(savedView)
		.where(and(...whereClauses))
		.orderBy(asc(savedView.name), asc(savedView.createdAt));

	return rows.map((row) => ({
		...row,
		queryDefinition: row.queryDefinition as SavedViewQueryDefinition,
	}));
};

export const getSavedViewByIdForUser = async (input: {
	userId: string;
	viewId: string;
}) => {
	const [foundView] = await db
		.select({
			id: savedView.id,
			icon: savedView.icon,
			name: savedView.name,
			facetId: savedView.facetId,
			isBuiltin: savedView.isBuiltin,
			accentColor: savedView.accentColor,
			queryDefinition: savedView.queryDefinition,
		})
		.from(savedView)
		.where(
			and(eq(savedView.userId, input.userId), eq(savedView.id, input.viewId)),
		)
		.limit(1);

	if (!foundView) return undefined;

	return {
		...foundView,
		queryDefinition: foundView.queryDefinition as SavedViewQueryDefinition,
	};
};

export const createSavedViewForUser = async (input: {
	icon: string;
	name: string;
	userId: string;
	facetId?: string;
	isBuiltin: boolean;
	accentColor: string;
	queryDefinition: SavedViewQueryDefinition;
}) => {
	const [createdView] = await db
		.insert(savedView)
		.values({
			icon: input.icon,
			name: input.name,
			userId: input.userId,
			facetId: input.facetId,
			isBuiltin: input.isBuiltin,
			accentColor: input.accentColor,
			queryDefinition: input.queryDefinition,
		})
		.returning({
			id: savedView.id,
			icon: savedView.icon,
			name: savedView.name,
			facetId: savedView.facetId,
			isBuiltin: savedView.isBuiltin,
			accentColor: savedView.accentColor,
			queryDefinition: savedView.queryDefinition,
		});

	if (!createdView) throw new Error("Could not persist saved view");

	return {
		...createdView,
		queryDefinition: createdView.queryDefinition as SavedViewQueryDefinition,
	};
};

export const createSavedViewsForUser = async (input: {
	userId: string;
	database?: DbClient;
	views: Array<{
		icon: string;
		name: string;
		facetId?: string;
		isBuiltin: boolean;
		accentColor: string;
		queryDefinition: SavedViewQueryDefinition;
	}>;
}) => {
	if (!input.views.length) return;

	const database = input.database ?? db;

	await database.insert(savedView).values(
		input.views.map((view) => ({
			icon: view.icon,
			name: view.name,
			userId: input.userId,
			facetId: view.facetId,
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
		.returning({
			id: savedView.id,
			icon: savedView.icon,
			name: savedView.name,
			facetId: savedView.facetId,
			isBuiltin: savedView.isBuiltin,
			accentColor: savedView.accentColor,
			queryDefinition: savedView.queryDefinition,
		});

	if (!deletedView) return undefined;

	return {
		...deletedView,
		queryDefinition: deletedView.queryDefinition as SavedViewQueryDefinition,
	};
};
