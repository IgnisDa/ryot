import type { Href } from "expo-router";

export type SafeRedirectTo = Extract<Href, `/${string}`>;

const redirectBase = new URL("https://ryot.invalid");

function isSafeRedirectTo(value: unknown): value is SafeRedirectTo {
	if (typeof value !== "string" || !value.startsWith("/")) {
		return false;
	}

	try {
		const url = new URL(value, redirectBase);
		return (
			url.origin === redirectBase.origin &&
			url.pathname !== "/auth" &&
			url.pathname !== "/onboarding"
		);
	} catch {
		return false;
	}
}

export function getSafeRedirectTo(value: string | string[] | undefined) {
	const redirectTo = Array.isArray(value) ? value[0] : value;
	return isSafeRedirectTo(redirectTo) ? redirectTo : undefined;
}
