import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "~/db";
import { type FacetMode, facet, userFacet } from "~/db/schema";

const facetVisibleToUserClause = (userId: string) => {
	return or(isNull(facet.userId), eq(facet.userId, userId));
};

export const listFacetsByUser = async (userId: string) => {
	const rows = await db
		.select({
			id: facet.id,
			slug: facet.slug,
			name: facet.name,
			icon: facet.icon,
			mode: facet.mode,
			config: facet.config,
			enabled: userFacet.enabled,
			isBuiltin: facet.isBuiltin,
			sortOrder: userFacet.sortOrder,
			accentColor: facet.accentColor,
			description: facet.description,
		})
		.from(facet)
		.leftJoin(
			userFacet,
			and(eq(userFacet.facetId, facet.id), eq(userFacet.userId, userId)),
		)
		.where(facetVisibleToUserClause(userId))
		.orderBy(
			desc(userFacet.enabled),
			asc(userFacet.sortOrder),
			asc(facet.name),
		);

	return rows.map((row) => ({
		...row,
		icon: row.icon ?? null,
		enabled: row.enabled ?? false,
		sortOrder: row.sortOrder ?? 0,
		description: row.description ?? null,
		accentColor: row.accentColor ?? null,
	}));
};

export const getVisibleFacetById = async (input: {
	userId: string;
	facetId: string;
}) => {
	const foundFacet = await getFacetScopeForUser(input);

	if (!foundFacet) return foundFacet;

	return { id: foundFacet.id };
};

export const getFacetScopeForUser = async (input: {
	userId: string;
	facetId: string;
}) => {
	const [foundFacet] = await db
		.select({
			id: facet.id,
			userId: facet.userId,
			isBuiltin: facet.isBuiltin,
		})
		.from(facet)
		.where(
			and(eq(facet.id, input.facetId), facetVisibleToUserClause(input.userId)),
		)
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
		facetVisibleToUserClause(input.userId),
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
		.select({
			id: facet.id,
			slug: facet.slug,
			name: facet.name,
			icon: facet.icon,
			description: facet.description,
			accentColor: facet.accentColor,
		})
		.from(facet)
		.where(and(eq(facet.id, input.facetId), eq(facet.userId, input.userId)))
		.limit(1);

	return ownedFacet;
};

export const createFacetForUser = async (input: {
	name: string;
	slug: string;
	icon?: string;
	userId: string;
	mode: FacetMode;
	description?: string;
	accentColor?: string;
}) => {
	return db.transaction(async (tx) => {
		const [orderRow] = await tx
			.select({
				maxSortOrder: sql<number>`coalesce(max(${userFacet.sortOrder}), -1)`,
			})
			.from(userFacet)
			.where(eq(userFacet.userId, input.userId));

		const nextSortOrder = Number(orderRow?.maxSortOrder ?? -1) + 1;

		const [createdFacet] = await tx
			.insert(facet)
			.values({
				slug: input.slug,
				name: input.name,
				icon: input.icon,
				mode: input.mode,
				isBuiltin: false,
				userId: input.userId,
				accentColor: input.accentColor,
				description: input.description,
			})
			.returning({
				id: facet.id,
				slug: facet.slug,
				name: facet.name,
				icon: facet.icon,
				mode: facet.mode,
				config: facet.config,
				isBuiltin: facet.isBuiltin,
				accentColor: facet.accentColor,
				description: facet.description,
			});

		if (!createdFacet) throw new Error("Could not persist facet");

		await tx.insert(userFacet).values({
			enabled: true,
			userId: input.userId,
			facetId: createdFacet.id,
			sortOrder: nextSortOrder,
		});

		return { ...createdFacet, enabled: true, sortOrder: nextSortOrder };
	});
};

export const setFacetEnabledForUser = async (input: {
	userId: string;
	facetId: string;
	enabled: boolean;
}) => {
	return db.transaction(async (tx) => {
		const [existingUserFacet] = await tx
			.select({ id: userFacet.id })
			.from(userFacet)
			.where(
				and(
					eq(userFacet.userId, input.userId),
					eq(userFacet.facetId, input.facetId),
				),
			)
			.limit(1)
			.for("update");

		if (existingUserFacet) {
			await tx
				.update(userFacet)
				.set({ enabled: input.enabled })
				.where(eq(userFacet.id, existingUserFacet.id));
			return;
		}

		const [orderRow] = await tx
			.select({
				maxSortOrder: sql<number>`coalesce(max(${userFacet.sortOrder}), -1)`,
			})
			.from(userFacet)
			.where(eq(userFacet.userId, input.userId));

		const nextSortOrder = Number(orderRow?.maxSortOrder ?? -1) + 1;

		await tx.insert(userFacet).values({
			userId: input.userId,
			facetId: input.facetId,
			enabled: input.enabled,
			sortOrder: nextSortOrder,
		});
	});
};

export const listUserFacetIdsInOrder = async (userId: string) => {
	const rows = await db
		.select({ facetId: userFacet.facetId })
		.from(userFacet)
		.where(eq(userFacet.userId, userId))
		.orderBy(asc(userFacet.sortOrder), asc(userFacet.createdAt));

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
			and(
				inArray(facet.id, input.facetIds),
				facetVisibleToUserClause(input.userId),
			),
		);

	return rows.length;
};

export const persistFacetOrderForUser = async (input: {
	userId: string;
	facetIds: string[];
}) => {
	return db.transaction(async (tx) => {
		const existingRows = await tx
			.select({
				id: userFacet.id,
				facetId: userFacet.facetId,
				enabled: userFacet.enabled,
			})
			.from(userFacet)
			.where(
				and(
					eq(userFacet.userId, input.userId),
					inArray(userFacet.facetId, input.facetIds),
				),
			);

		const existingByFacetId = new Map(
			existingRows.map((row) => [row.facetId, row]),
		);

		for (const [index, facetId] of input.facetIds.entries()) {
			const existing = existingByFacetId.get(facetId);

			if (existing) {
				await tx
					.update(userFacet)
					.set({ sortOrder: index })
					.where(eq(userFacet.id, existing.id));
				continue;
			}

			await tx.insert(userFacet).values({
				facetId,
				enabled: true,
				sortOrder: index,
				userId: input.userId,
			});
		}

		return input.facetIds;
	});
};

export const updateFacetForUser = async (input: {
	slug: string;
	name: string;
	userId: string;
	facetId: string;
	icon: string | null;
	description: string | null;
	accentColor: string | null;
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
		.returning({
			id: facet.id,
			slug: facet.slug,
			name: facet.name,
			icon: facet.icon,
			mode: facet.mode,
			config: facet.config,
			isBuiltin: facet.isBuiltin,
			accentColor: facet.accentColor,
			description: facet.description,
		});

	if (!updatedFacet) throw new Error("Could not update facet");

	const [associatedUserFacet] = await db
		.select({
			enabled: userFacet.enabled,
			sortOrder: userFacet.sortOrder,
		})
		.from(userFacet)
		.where(
			and(
				eq(userFacet.userId, input.userId),
				eq(userFacet.facetId, input.facetId),
			),
		)
		.limit(1);

	return {
		...updatedFacet,
		enabled: associatedUserFacet?.enabled ?? false,
		sortOrder: associatedUserFacet?.sortOrder ?? 0,
	};
};
