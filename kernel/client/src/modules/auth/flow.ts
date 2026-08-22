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
