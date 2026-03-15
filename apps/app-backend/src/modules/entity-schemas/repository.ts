import { and, asc, eq } from "drizzle-orm";
import { db } from "~/db";
import { entitySchema } from "~/db/schema";
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
	userId: string;
	slug: string;
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
	const [createdEntitySchema] = await db
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

	if (!createdEntitySchema) throw new Error("Could not persist entity schema");

	return {
		...createdEntitySchema,
		propertiesSchema:
			createdEntitySchema.propertiesSchema as EntitySchemaPropertiesShape,
	};
};
