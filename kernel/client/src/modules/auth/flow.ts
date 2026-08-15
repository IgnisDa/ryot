import { sanitizeRedirect, type SafeRedirect } from "../server/redirect";

export type AuthMode = "login" | "signup";
export type TwoFactorMethod = "totp" | "backupCode";

export const authDestination = (value: unknown): SafeRedirect => sanitizeRedirect(value) ?? "/";

export const isTwoFactorRedirect = (
	data: unknown,
): data is { twoFactorRedirect: true; twoFactorMethods?: string[] } =>
	typeof data === "object" &&
	data !== null &&
	"twoFactorRedirect" in data &&
	data.twoFactorRedirect === true;

export const availableTwoFactorMethods = (configured: readonly string[] | undefined) =>
	configured?.includes("totp") ? (["totp", "backupCode"] as const) : (["backupCode"] as const);

export const authErrorMessage = (error: unknown, fallback: string) => {
	if (typeof error === "object" && error !== null && "message" in error) {
		const message = error.message;
		if (typeof message === "string" && message.trim() !== "") {
			return message;
		}
	}
	return fallback;
};

export async function signOutToAuth(operations: {
	readonly clearAuth: () => void;
	readonly signOut: () => Promise<unknown>;
	readonly navigate: () => Promise<unknown>;
}) {
	try {
		await operations.signOut();
	} catch {
		// The local session must still close when the selected server is unavailable.
	}
	operations.clearAuth();
	await operations.navigate();
}
