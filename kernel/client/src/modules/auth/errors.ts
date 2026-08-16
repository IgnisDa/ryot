export type AuthOperation = "oidc" | "reset-password" | "sign-in" | "sign-up" | "two-factor";

type AuthError = {
	readonly code?: unknown;
	readonly status?: unknown;
};

const fallbackMessages: Record<AuthOperation, string> = {
	oidc: "OpenID Connect sign-in failed.",
	"sign-up": "Could not create your account.",
	"two-factor": "That code could not be verified.",
	"reset-password": "Could not reset your password.",
	"sign-in": "Could not sign in. Check your connection and try again.",
};

const codeMessages: Partial<Record<AuthOperation, Record<string, string>>> = {
	"sign-in": { INVALID_EMAIL_OR_PASSWORD: "The email or password is incorrect." },
	"reset-password": { INVALID_TOKEN: "This password reset link is invalid or has expired." },
	"sign-up": {
		USER_ALREADY_EXISTS: "An account already exists for this email.",
		USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "An account already exists for this email.",
	},
	"two-factor": {
		INVALID_BACKUP_CODE: "That backup code is invalid.",
		INVALID_CODE: "That authenticator code is invalid.",
	},
};
const diagnosticCodes = new Set(
	Object.values(codeMessages).flatMap((messages) => Object.keys(messages)),
);

const asAuthError = (cause: unknown): AuthError =>
	typeof cause === "object" && cause !== null ? cause : {};

export const getAuthErrorMessage = (operation: AuthOperation, cause: unknown) => {
	const { code } = asAuthError(cause);
	return (
		(typeof code === "string" ? codeMessages[operation]?.[code] : undefined) ??
		fallbackMessages[operation]
	);
};

export const getAuthErrorDiagnostic = (operation: AuthOperation, cause: unknown) => {
	const error = asAuthError(cause);
	const code = typeof error.code === "string" && diagnosticCodes.has(error.code);
	const status =
		typeof error.status === "number" &&
		Number.isInteger(error.status) &&
		error.status >= 100 &&
		error.status <= 599;
	return {
		operation,
		kind: cause instanceof Error ? "exception" : "response",
		...(code ? { code: error.code } : {}),
		...(status ? { status: error.status } : {}),
	} as const;
};

export const logAuthError = (operation: AuthOperation, cause: unknown) =>
	globalThis.console.error(
		"Authentication request failed",
		getAuthErrorDiagnostic(operation, cause),
	);

export const reportAuthFailure = (operation: AuthOperation, cause: unknown) => {
	logAuthError(operation, cause);
	return getAuthErrorMessage(operation, cause);
};
