import { redirect } from "@tanstack/react-router";
import { Effect } from "effect";

import type { ServerOrigin } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { AuthService, toAuthSessionState } from "#/modules/auth/service";
import { type SafeRedirect, sanitizeRedirect } from "#/modules/server/redirect";
import { ServerService } from "#/modules/server/service";

export type AuthSessionState =
	| { readonly status: "pending" }
	| { readonly status: "missing" }
	| { readonly userId: string; readonly status: "authenticated" };

export type ProtectedRouteDecision =
	| { readonly action: "wait" }
	| { readonly action: "allow"; readonly scope: ApiScope }
	| {
			readonly action: "redirect";
			readonly to: "/auth" | "/onboarding";
			readonly redirectTo: undefined | SafeRedirect;
	  };

export type AuthRouteDecision =
	| { readonly action: "wait" }
	| { readonly to: SafeRedirect; readonly action: "redirect" }
	| { readonly action: "stay"; readonly redirectTo: undefined | SafeRedirect }
	| {
			readonly to: "/onboarding";
			readonly action: "redirect";
			readonly redirectTo: undefined | SafeRedirect;
	  };

export function decideAuthRoute(
	server: null | ServerOrigin,
	session: AuthSessionState,
	redirectIntent: unknown,
): AuthRouteDecision {
	const redirectTo = sanitizeRedirect(redirectIntent);
	if (server === null) {
		return { redirectTo, to: "/onboarding", action: "redirect" };
	}
	if (session.status === "pending") {
		return { action: "wait" };
	}
	if (session.status === "authenticated") {
		return { action: "redirect", to: redirectTo ?? "/" };
	}
	return { redirectTo, action: "stay" };
}

export function decideProtectedRoute(
	server: null | ServerOrigin,
	session: AuthSessionState,
	destination: unknown,
): ProtectedRouteDecision {
	const redirectTo = sanitizeRedirect(destination);
	if (server === null) {
		return { redirectTo, to: "/onboarding", action: "redirect" };
	}
	if (session.status === "pending") {
		return { action: "wait" };
	}
	if (session.status === "missing") {
		return { redirectTo, to: "/auth", action: "redirect" };
	}
	return { action: "allow", scope: { serverUrl: server, userId: session.userId } };
}

export function protectedRouteGuard(destination: string) {
	return Effect.gen(function* () {
		const server = yield* Effect.flatMap(ServerService, (service) => service.selected);
		if (server === null) {
			// oxlint-disable-next-line typescript/only-throw-error
			throw redirect({ replace: true, to: "/onboarding", search: { redirect: destination } });
		}
		const session = yield* Effect.flatMap(AuthService, (service) => service.settledSession(server));
		const decision = decideProtectedRoute(server, toAuthSessionState(session), destination);
		if (decision.action === "redirect") {
			// oxlint-disable-next-line typescript/only-throw-error
			throw redirect({ replace: true, to: decision.to, search: { redirect: decision.redirectTo } });
		}
		if (decision.action === "wait") {
			throw new Error("Unreachable: settledSession never resolves a pending session.");
		}
		return { server, scope: decision.scope };
	});
}
