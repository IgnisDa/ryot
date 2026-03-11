import { and, asc, eq } from "drizzle-orm";
import { db } from "~/lib/db";
import { entitySchema, savedView } from "~/lib/db/schema";
import type { SavedViewQueryDefinition } from "./schemas";

export const listSavedViewsForUser = async (input: { userId: string }) => {
	const rows = await db
		.select({
			id: savedView.id,
			name: savedView.name,
			isBuiltin: savedView.isBuiltin,
			queryDefinition: savedView.queryDefinition,
		})
		.from(savedView)
		.where(eq(savedView.userId, input.userId))
		.orderBy(asc(savedView.name), asc(savedView.createdAt));

	return rows.map((row) => ({
		...row,
		queryDefinition: row.queryDefinition as SavedViewQueryDefinition,
	}));
};

export const listEntitySchemaIdsByFacetForUser = async (input: {
	userId: string;
	facetId: string;
}) => {
	const rows = await db
		.select({ id: entitySchema.id })
		.from(entitySchema)
		.where(
			and(
				eq(entitySchema.userId, input.userId),
				eq(entitySchema.facetId, input.facetId),
			),
		);

	return rows.map((row) => row.id);
};

export const getSavedViewByIdForUser = async (input: {
	userId: string;
	viewId: string;
}) => {
	const [foundView] = await db
		.select({
			id: savedView.id,
			name: savedView.name,
			isBuiltin: savedView.isBuiltin,
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
	name: string;
	userId: string;
	isBuiltin: boolean;
	queryDefinition: SavedViewQueryDefinition;
}) => {
	const [createdView] = await db
		.insert(savedView)
		.values({
			name: input.name,
			userId: input.userId,
			isBuiltin: input.isBuiltin,
			queryDefinition: input.queryDefinition,
		})
		.returning({
			id: savedView.id,
			name: savedView.name,
			isBuiltin: savedView.isBuiltin,
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
	views: Array<{
		name: string;
		isBuiltin: boolean;
		queryDefinition: SavedViewQueryDefinition;
	}>;
}) => {
	if (!input.views.length) return;

	await db.insert(savedView).values(
		input.views.map((view) => ({
			name: view.name,
			userId: input.userId,
			isBuiltin: view.isBuiltin,
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
			name: savedView.name,
			isBuiltin: savedView.isBuiltin,
			queryDefinition: savedView.queryDefinition,
		});

	if (!deletedView) return undefined;

	return {
		...deletedView,
		queryDefinition: deletedView.queryDefinition as SavedViewQueryDefinition,
	};
};
