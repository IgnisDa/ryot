import { and, eq, isNull, or } from "drizzle-orm";

import { db } from "~/lib/db";
import { relationshipSchema } from "~/lib/db/schema";

export const getBuiltinRelationshipSchemaBySlug = async (slug: string) => {
	const [found] = await db
		.select({
			id: relationshipSchema.id,
			propertiesSchema: relationshipSchema.propertiesSchema,
		})
		.from(relationshipSchema)
		.where(
			and(
				eq(relationshipSchema.slug, slug),
				isNull(relationshipSchema.userId),
				eq(relationshipSchema.isBuiltin, true),
			),
		)
		.limit(1);

	return found;
};

export const getRelationshipSchemaById = async (id: string, userId: string | null) => {
	const [found] = await db
		.select({
			id: relationshipSchema.id,
			propertiesSchema: relationshipSchema.propertiesSchema,
		})
		.from(relationshipSchema)
		.where(
			and(
				eq(relationshipSchema.id, id),
				userId !== null
					? or(isNull(relationshipSchema.userId), eq(relationshipSchema.userId, userId))
					: isNull(relationshipSchema.userId),
			),
		)
		.limit(1);

	return found;
};
