export const mediaFailureMessage = (error: unknown): string => {
	if (typeof error === "string") {
		return error;
	}
	if (typeof error === "object" && error !== null && "message" in error) {
		const message: unknown = error.message;
		if (typeof message === "string") {
			return message;
		}
	}
	return "Media sandbox operation failed";
};
