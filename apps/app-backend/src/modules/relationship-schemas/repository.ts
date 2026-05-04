import { and, eq, isNull } from "drizzle-orm";

import { db } from "~/lib/db";
import { relationshipSchema } from "~/lib/db/schema";

export const getBuiltinRelationshipSchemaBySlug = async (slug: string) => {
	const [found] = await db
		.select({ id: relationshipSchema.id })
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
