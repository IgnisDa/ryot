type EntitySchemaScope = {
	id: string;
	isBuiltin: boolean;
	userId: string | null;
};

export const resolveCustomEntitySchemaAccess = <
	T extends EntitySchemaScope | undefined,
>(
	entitySchema: T,
) => {
	if (!entitySchema) return { error: "not_found" as const };
	if (entitySchema.isBuiltin) return { error: "builtin" as const };

	return { entitySchema };
};
