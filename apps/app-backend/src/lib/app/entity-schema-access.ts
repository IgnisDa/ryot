type CustomEntityScope = {
	isBuiltin: boolean;
};

export type CustomEntityAccessError = "builtin" | "not_found";

type EntitySchemaReadAccessResult<T extends CustomEntityScope> =
	| { error: "not_found" }
	| { entitySchema: T };

type CustomEntitySchemaAccessResult<T extends CustomEntityScope> =
	| { error: CustomEntityAccessError }
	| { entitySchema: T };

export const resolveEntitySchemaReadAccess = <T extends CustomEntityScope>(
	entitySchema: T | undefined,
): EntitySchemaReadAccessResult<T> => {
	if (!entitySchema) {
		return { error: "not_found" as const };
	}

	return { entitySchema };
};

export const resolveCustomEntitySchemaAccess = <T extends CustomEntityScope>(
	entitySchema: T | undefined,
): CustomEntitySchemaAccessResult<T> => {
	const entitySchemaResult = resolveEntitySchemaReadAccess(entitySchema);
	if (!("entitySchema" in entitySchemaResult)) {
		return entitySchemaResult;
	}

	if (entitySchemaResult.entitySchema.isBuiltin) {
		return { error: "builtin" as const };
	}

	return entitySchemaResult;
};
