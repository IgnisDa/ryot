import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "~/db";
import { type FacetMode, facet, userFacet } from "~/db/schema";

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
		.where(or(isNull(facet.userId), eq(facet.userId, userId)))
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
	const [foundFacet] = await db
		.select({ id: facet.id })
		.from(facet)
		.where(
			and(
				eq(facet.id, input.facetId),
				or(isNull(facet.userId), eq(facet.userId, input.userId)),
			),
		)
		.limit(1);

	return foundFacet;
};

export const getFacetBySlugForUser = async (input: {
	userId: string;
	slug: string;
}) => {
	const [foundFacet] = await db
		.select({ id: facet.id })
		.from(facet)
		.where(
			and(
				eq(facet.slug, input.slug),
				or(isNull(facet.userId), eq(facet.userId, input.userId)),
			),
		)
		.limit(1);

	return foundFacet;
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
