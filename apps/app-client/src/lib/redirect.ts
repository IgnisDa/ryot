import type { Href } from "expo-router";

declare const safeRedirectTo: unique symbol;

export type SafeRedirectTo = `/${string}` & { readonly [safeRedirectTo]: true };

type GatePath = "/auth" | "/onboarding";

const redirectBase = new URL("https://ryot.invalid");

function isSafeRedirectTo(value: unknown): value is SafeRedirectTo {
	if (typeof value !== "string" || !value.startsWith("/")) {
		return false;
	}

	try {
		const url = new URL(value, redirectBase);
		const pathname = decodeURIComponent(url.pathname)
			.replaceAll("\\", "/")
			.replace(/\/{2,}/g, "/")
			.replace(/\/$/, "");
		const isGatePath =
			pathname === "/auth" ||
			pathname.startsWith("/auth/") ||
			pathname === "/onboarding" ||
			pathname.startsWith("/onboarding/");
		return url.origin === redirectBase.origin && !isGatePath;
	} catch {
		return false;
	}
}

export function getSafeRedirectTo(value: string | string[] | undefined) {
	return isSafeRedirectTo(value) ? value : undefined;
}

export function getGateHref(pathname: GatePath, redirectTo?: SafeRedirectTo) {
	return { pathname, params: { redirectTo } };
}

export function getRedirectDestination(
	redirectTo: SafeRedirectTo | undefined,
	fallback: Extract<Href, string>,
) {
	if (!redirectTo) {
		return fallback;
	}

	// Runtime validation establishes an internal path that generated route types cannot represent.
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	return redirectTo as Extract<Href, string>;
}
