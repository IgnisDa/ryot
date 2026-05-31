import type { ServerOrigin } from "../../api/origin";
import { canonicalApiScope, type ApiScope } from "../../api/scope";
import { sanitizeRedirect, type SafeRedirect } from "../server/redirect";

export type AuthSessionState =
	| { readonly status: "pending" }
	| { readonly status: "missing" }
	| { readonly status: "authenticated"; readonly userId: string };

export type AuthRouteDecision =
	| { readonly action: "wait" }
	| { readonly action: "redirect"; readonly to: SafeRedirect }
	| { readonly action: "stay"; readonly redirectTo: SafeRedirect | undefined }
	| {
			readonly to: "/onboarding";
			readonly action: "redirect";
			readonly redirectTo: SafeRedirect | undefined;
	  };

export type ProtectedRouteDecision =
	| { readonly action: "wait" }
	| { readonly action: "allow"; readonly scope: ApiScope }
	| {
			readonly action: "redirect";
			readonly to: "/auth" | "/onboarding";
			readonly redirectTo: SafeRedirect | undefined;
	  };

export function decideAuthRoute(
	server: ServerOrigin | null,
	session: AuthSessionState,
	redirectIntent: unknown,
): AuthRouteDecision {
	const redirectTo = sanitizeRedirect(redirectIntent);
	if (server === null) {
		return { action: "redirect", redirectTo, to: "/onboarding" };
	}
	if (session.status === "pending") {
		return { action: "wait" };
	}
	if (session.status === "authenticated") {
		return { action: "redirect", to: redirectTo ?? "/" };
	}
	return { action: "stay", redirectTo };
}

export function decideProtectedRoute(
	server: ServerOrigin | null,
	session: AuthSessionState,
	destination: unknown,
): ProtectedRouteDecision {
	const redirectTo = sanitizeRedirect(destination);
	if (server === null) {
		return { action: "redirect", redirectTo, to: "/onboarding" };
	}
	if (session.status === "pending") {
		return { action: "wait" };
	}
	if (session.status === "missing") {
		return { action: "redirect", redirectTo, to: "/auth" };
	}
	return {
		action: "allow",
		scope: canonicalApiScope({ serverUrl: server, userId: session.userId }),
	};
}
