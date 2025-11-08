import { and, asc, eq } from "drizzle-orm";
import { db } from "~/db";
import { entitySchema, savedView } from "~/db/schema";
import { buildBuiltinSavedViewName } from "../saved-views/service";
import type { EntitySchemaPropertiesShape } from "./service";

export const listEntitySchemasByFacetForUser = async (input: {
	userId: string;
	facetId: string;
}) => {
	const rows = await db
		.select({
			id: entitySchema.id,
			name: entitySchema.name,
			slug: entitySchema.slug,
			facetId: entitySchema.facetId,
			isBuiltin: entitySchema.isBuiltin,
			propertiesSchema: entitySchema.propertiesSchema,
		})
		.from(entitySchema)
		.where(
			and(
				eq(entitySchema.userId, input.userId),
				eq(entitySchema.facetId, input.facetId),
			),
		)
		.orderBy(asc(entitySchema.name), asc(entitySchema.createdAt));

	return rows.map((row) => ({
		...row,
		propertiesSchema: row.propertiesSchema as EntitySchemaPropertiesShape,
	}));
};

export const getEntitySchemaBySlugForUser = async (input: {
	slug: string;
	userId: string;
}) => {
	const [foundEntitySchema] = await db
		.select({ id: entitySchema.id })
		.from(entitySchema)
		.where(
			and(
				eq(entitySchema.userId, input.userId),
				eq(entitySchema.slug, input.slug),
			),
		)
		.limit(1);

	return foundEntitySchema;
};

export const createEntitySchemaForUser = async (input: {
	name: string;
	slug: string;
	userId: string;
	facetId: string;
	propertiesSchema: EntitySchemaPropertiesShape;
}) => {
	return await db.transaction(async (tx) => {
		const [createdEntitySchema] = await tx
			.insert(entitySchema)
			.values({
				name: input.name,
				slug: input.slug,
				isBuiltin: false,
				userId: input.userId,
				facetId: input.facetId,
				propertiesSchema: input.propertiesSchema,
			})
			.returning({
				id: entitySchema.id,
				name: entitySchema.name,
				slug: entitySchema.slug,
				facetId: entitySchema.facetId,
				isBuiltin: entitySchema.isBuiltin,
				propertiesSchema: entitySchema.propertiesSchema,
			});

		if (!createdEntitySchema)
			throw new Error("Could not persist entity schema");

		const [createdSavedView] = await tx
			.insert(savedView)
			.values({
				isBuiltin: true,
				userId: input.userId,
				name: buildBuiltinSavedViewName(input.name),
				queryDefinition: { entitySchemaIds: [createdEntitySchema.id] },
			})
			.returning({ id: savedView.id });

		if (!createdSavedView)
			throw new Error("Could not persist built-in saved view");

		return {
			...createdEntitySchema,
			propertiesSchema:
				createdEntitySchema.propertiesSchema as EntitySchemaPropertiesShape,
		};
	});
};
