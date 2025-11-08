type CustomEntityScope = {
	isBuiltin: boolean;
};

export type CustomEntityAccessError = "builtin" | "not_found";

type CustomEntitySchemaAccessResult<T extends CustomEntityScope> =
	| { error: CustomEntityAccessError }
	| { entitySchema: T };

export const resolveCustomEntitySchemaAccess = <T extends CustomEntityScope>(
	entitySchema: T | undefined,
): CustomEntitySchemaAccessResult<T> => {
	if (!entitySchema) return { error: "not_found" as const };
	if (entitySchema.isBuiltin) return { error: "builtin" as const };

	return { entitySchema };
};

export const resolveCustomEntityAccessError = (input: {
	builtinMessage: string;
	notFoundMessage: string;
	error: CustomEntityAccessError;
}) => {
	if (input.error === "not_found")
		return {
			error: "not_found" as const,
			message: input.notFoundMessage,
		};

	return {
		error: "builtin" as const,
		message: input.builtinMessage,
	};
};
