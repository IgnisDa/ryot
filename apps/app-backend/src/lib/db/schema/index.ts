import { entitySchema } from "./tables";

export const entitySchemaAccessScopeSelection = {
	id: entitySchema.id,
	slug: entitySchema.slug,
	userId: entitySchema.userId,
	isBuiltin: entitySchema.isBuiltin,
};
