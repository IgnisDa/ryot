import type { EntitySchemaId, UserId } from "@ryot/contract/schema/brands";
import { and, eq, isNull, or } from "drizzle-orm";

import { entitySchema } from "./tables/combined";

export const entitySchemaAccessScopeSelection = {
	id: entitySchema.id,
	slug: entitySchema.slug,
	userId: entitySchema.userId,
	isBuiltin: entitySchema.isBuiltin,
};

export const entitySchemaAccessScopeWhere = (input: {
	userId: UserId;
	entitySchemaId: EntitySchemaId;
}) =>
	and(
		eq(entitySchema.id, input.entitySchemaId),
		or(isNull(entitySchema.userId), eq(entitySchema.userId, input.userId)),
	);
