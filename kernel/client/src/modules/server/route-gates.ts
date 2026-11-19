import type { ServerOrigin } from "#/api/origin";
import { type SafeRedirect, sanitizeRedirect } from "#/modules/server/redirect";

export type OnboardingCompletionDecision = Exclude<OnboardingGateDecision, { action: "stay" }>;

export type RootGateDecision =
	| { readonly to: "/auth"; readonly action: "redirect" }
	| { readonly to: "/onboarding"; readonly action: "redirect" };

export type OnboardingGateDecision =
	| { readonly to: SafeRedirect; readonly action: "enter-instance-admin" }
	| { readonly action: "stay"; readonly redirectTo: undefined | SafeRedirect }
	| {
			readonly to: "/auth";
			readonly action: "start-oauth";
			readonly redirectTo: undefined | SafeRedirect;
	  };

export const decideRootGate = (
	isNative: boolean,
	server: null | ServerOrigin,
): RootGateDecision => ({
	action: "redirect",
	to: isNative && server === null ? "/onboarding" : "/auth",
});

export function decideOnboardingGate(
	isNative: boolean,
	server: null | ServerOrigin,
	redirectIntent: unknown,
): OnboardingGateDecision {
	return isNative && server === null
		? { action: "stay", redirectTo: sanitizeRedirect(redirectIntent) }
		: decideOnboardingCompletion(redirectIntent);
}

export function decideOnboardingCompletion(redirectIntent: unknown): OnboardingCompletionDecision {
	const redirectTo = sanitizeRedirect(redirectIntent);
	const pathname = redirectTo && new URL(redirectTo, "https://ryot.invalid").pathname;
	return redirectTo !== undefined &&
		pathname !== undefined &&
		/^\/instance-admin(?:\/|$)/.test(pathname)
		? { to: redirectTo, action: "enter-instance-admin" }
		: { redirectTo, to: "/auth", action: "start-oauth" };
}
