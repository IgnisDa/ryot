import { sanitizeRedirect, type SafeRedirect } from "#/modules/server/redirect";

export type AuthMode = "login" | "signup";
export type TwoFactorMethod = "totp" | "backupCode";

export const authDestination = (value: unknown): SafeRedirect => sanitizeRedirect(value) ?? "/";

export const oidcCallbackURL = (destination: SafeRedirect, isNative: boolean) => {
	const base = isNative ? "ryot://auth/callback" : "/auth/callback";
	const query = new URLSearchParams({ redirect: destination });
	return `${base}?${query.toString()}`;
};

export const isTwoFactorRedirect = (
	data: unknown,
): data is { twoFactorRedirect: true; twoFactorMethods?: string[] } =>
	typeof data === "object" &&
	data !== null &&
	"twoFactorRedirect" in data &&
	data.twoFactorRedirect === true;

export const availableTwoFactorMethods = (configured: readonly string[] | undefined) =>
	configured?.includes("totp") ? (["totp", "backupCode"] as const) : (["backupCode"] as const);
