export function getErrorMessage(
	error: unknown,
	fallback = "Something went wrong. Please try again.",
) {
	if (error instanceof Error && error.message) {
		return error.message;
	}

	const parsed = error as { message?: string; error?: { message?: string } };

	return parsed?.error?.message ?? parsed?.message ?? fallback;
}
