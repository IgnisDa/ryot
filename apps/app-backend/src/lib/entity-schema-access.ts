type CustomEntityScope = {
	isBuiltin: boolean;
};

type CustomEntityAccessError = "builtin" | "not_found";

export const resolveCustomEntitySchemaAccess = <
	T extends CustomEntityScope | undefined,
>(
	entitySchema: T,
) => {
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
			status: 404 as const,
			kind: "not_found" as const,
			message: input.notFoundMessage,
		};

	return {
		status: 400 as const,
		kind: "validation" as const,
		message: input.builtinMessage,
	};
};
