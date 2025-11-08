export const isUniqueConstraintError = (
	error: unknown,
	constraintName: string,
) => {
	if (!error || typeof error !== "object") return false;

	const code = "code" in error ? error.code : undefined;
	const constraint = "constraint" in error ? error.constraint : undefined;

	return code === "23505" && constraint === constraintName;
};
