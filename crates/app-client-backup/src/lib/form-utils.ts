export function resolveError(error: unknown): string | undefined {
	if (typeof error === "string") {
		return error;
	}
	if (error && typeof error === "object" && "message" in error) {
		return String((error as { message: unknown }).message);
	}
	return undefined;
}
