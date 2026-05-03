export const ERROR_CODES = {
	TIMEOUT: "timeout",
	NOT_FOUND: "not_found",
	RATE_LIMITED: "rate_limited",
	INTERNAL_ERROR: "internal_error",
	UNAUTHENTICATED: "unauthenticated",
	VALIDATION_FAILED: "validation_failed",
	HEALTH_CHECK_FAILED: "health_check_failed",
} as const;

export const errorResponse = (code: string, message: string) => ({
	error: { code, message },
});
