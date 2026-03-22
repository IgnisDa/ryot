import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { type DbClient, db } from "~/lib/db";
import { facet } from "~/lib/db/schema";
import type { ListedFacet } from "./schemas";

type FacetRow = Omit<ListedFacet, "description"> & {
	description: string | null;
};

const facetSelection = {
	id: facet.id,
	slug: facet.slug,
	name: facet.name,
	icon: facet.icon,
	config: facet.config,
	enabled: facet.enabled,
	isBuiltin: facet.isBuiltin,
	sortOrder: facet.sortOrder,
	accentColor: facet.accentColor,
	description: facet.description,
};

const facetScopeSelection = {
	id: facet.id,
	userId: facet.userId,
	isBuiltin: facet.isBuiltin,
};

const ownedFacetSelection = {
	id: facet.id,
	slug: facet.slug,
	name: facet.name,
	icon: facet.icon,
	description: facet.description,
	accentColor: facet.accentColor,
};

const facetSlugSelection = {
	id: facet.id,
	slug: facet.slug,
};

const toListedFacet = (row: FacetRow): ListedFacet => ({
	...row,
	description: row.description ?? null,
});

export const listFacetsByUser = async (userId: string) => {
	const rows = await db
		.select(facetSelection)
		.from(facet)
		.where(eq(facet.userId, userId))
		.orderBy(desc(facet.enabled), asc(facet.sortOrder), asc(facet.name));

	return rows.map(toListedFacet);
};

export const getVisibleFacetById = async (input: {
	userId: string;
	facetId: string;
}) => {
	const foundFacet = await getFacetScopeForUser(input);
	return foundFacet ? { id: foundFacet.id } : foundFacet;
};

export const getFacetScopeForUser = async (input: {
	userId: string;
	facetId: string;
}) => {
	const [foundFacet] = await db
		.select(facetScopeSelection)
		.from(facet)
		.where(and(eq(facet.id, input.facetId), eq(facet.userId, input.userId)))
		.limit(1);

	return foundFacet;
};

export const getFacetBySlugForUser = async (input: {
	userId: string;
	slug: string;
	excludeFacetId?: string;
}) => {
	const whereClauses = [
		eq(facet.slug, input.slug),
		eq(facet.userId, input.userId),
	];

	if (input.excludeFacetId)
		whereClauses.push(ne(facet.id, input.excludeFacetId));

	const [foundFacet] = await db
		.select({ id: facet.id })
		.from(facet)
		.where(and(...whereClauses))
		.limit(1);

	return foundFacet;
};

export const getOwnedFacetById = async (input: {
	userId: string;
	facetId: string;
}) => {
	const [ownedFacet] = await db
		.select(ownedFacetSelection)
		.from(facet)
		.where(and(eq(facet.id, input.facetId), eq(facet.userId, input.userId)))
		.limit(1);

	return ownedFacet;
};

export const createFacetForUser = async (input: {
	name: string;
	slug: string;
	icon: string;
	userId: string;
	accentColor: string;
	description?: string;
}) => {
	const [orderRow] = await db
		.select({
			maxSortOrder: sql<number>`coalesce(max(${facet.sortOrder}), -1)`,
		})
		.from(facet)
		.where(eq(facet.userId, input.userId));

	const nextSortOrder = Number(orderRow?.maxSortOrder ?? -1) + 1;

	const [createdFacet] = await db
		.insert(facet)
		.values({
			enabled: true,
			isBuiltin: false,
			slug: input.slug,
			name: input.name,
			icon: input.icon,
			userId: input.userId,
			sortOrder: nextSortOrder,
			accentColor: input.accentColor,
			description: input.description,
		})
		.returning(facetSelection);

	if (!createdFacet) throw new Error("Could not persist facet");

	return toListedFacet(createdFacet);
};

export const createBuiltinFacetsForUser = async (input: {
	userId: string;
	database?: DbClient;
	facets: Array<{
		slug: string;
		icon: string;
		name: string;
		accentColor: string;
		description?: string;
	}>;
}) => {
	if (!input.facets.length) return [];

	const database = input.database ?? db;

	const rows = await database
		.insert(facet)
		.values(
			input.facets.map((item, index) => ({
				enabled: true,
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
		.returning(facetSlugSelection);

	return rows;
};

export const setFacetEnabledForUser = async (input: {
	userId: string;
	facetId: string;
	enabled: boolean;
}) => {
	await db
		.update(facet)
		.set({ enabled: input.enabled })
		.where(and(eq(facet.id, input.facetId), eq(facet.userId, input.userId)));
};

export const listUserFacetIdsInOrder = async (userId: string) => {
	const rows = await db
		.select({ facetId: facet.id })
		.from(facet)
		.where(eq(facet.userId, userId))
		.orderBy(asc(facet.sortOrder), asc(facet.createdAt));

	return rows.map((row) => row.facetId);
};

export const countVisibleFacetsByIdsForUser = async (input: {
	userId: string;
	facetIds: string[];
}) => {
	if (!input.facetIds.length) return 0;

	const rows = await db
		.select({ id: facet.id })
		.from(facet)
		.where(
			and(eq(facet.userId, input.userId), inArray(facet.id, input.facetIds)),
		);

	return rows.length;
};

export const persistFacetOrderForUser = async (input: {
	userId: string;
	facetIds: string[];
}) => {
	await db.transaction(async (tx) => {
		for (const [index, facetId] of input.facetIds.entries()) {
			await tx
				.update(facet)
				.set({ sortOrder: index })
				.where(and(eq(facet.id, facetId), eq(facet.userId, input.userId)));
		}
	});

	return input.facetIds;
};

export const updateFacetForUser = async (input: {
	slug: string;
	icon: string;
	name: string;
	userId: string;
	facetId: string;
	accentColor: string;
	description: string | null;
}) => {
	const [updatedFacet] = await db
		.update(facet)
		.set({
			slug: input.slug,
			name: input.name,
			icon: input.icon,
			description: input.description,
			accentColor: input.accentColor,
		})
		.where(and(eq(facet.id, input.facetId), eq(facet.userId, input.userId)))
		.returning(facetSelection);

	if (!updatedFacet) throw new Error("Could not update facet");

	return toListedFacet(updatedFacet);
};
