type CustomEntityScope = {
	isBuiltin: boolean;
};

export type CustomEntityAccessError = "not_found";

type CustomEntitySchemaAccessResult<T extends CustomEntityScope> =
	| { error: CustomEntityAccessError }
	| { entitySchema: T };

export const resolveCustomEntitySchemaAccess = <T extends CustomEntityScope>(
	entitySchema: T | undefined,
): CustomEntitySchemaAccessResult<T> => {
	if (!entitySchema) {
		return { error: "not_found" as const };
	}

	return { entitySchema };
};
