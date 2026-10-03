import type { ServerOrigin } from "#/api/origin";
import { sanitizeRedirect, type SafeRedirect } from "#/modules/server/redirect";

export type RootGateDecision =
	| { readonly action: "redirect"; readonly to: "/auth" }
	| { readonly action: "redirect"; readonly to: "/onboarding" };

export type OnboardingGateDecision =
	| { readonly action: "enter-god-mode"; readonly to: SafeRedirect }
	| { readonly action: "stay"; readonly redirectTo: SafeRedirect | undefined }
	| {
			readonly to: "/auth";
			readonly action: "start-oauth";
			readonly redirectTo: SafeRedirect | undefined;
	  };

export type OnboardingCompletionDecision = Exclude<OnboardingGateDecision, { action: "stay" }>;

export const decideRootGate = (
	isNative: boolean,
	server: ServerOrigin | null,
): RootGateDecision => ({
	action: "redirect",
	to: isNative && server === null ? "/onboarding" : "/auth",
});

export function decideOnboardingGate(
	isNative: boolean,
	server: ServerOrigin | null,
	redirectIntent: unknown,
): OnboardingGateDecision {
	return isNative && server === null
		? { action: "stay", redirectTo: sanitizeRedirect(redirectIntent) }
		: decideOnboardingCompletion(redirectIntent);
}

export function decideOnboardingCompletion(redirectIntent: unknown): OnboardingCompletionDecision {
	const redirectTo = sanitizeRedirect(redirectIntent);
	const pathname = redirectTo && new URL(redirectTo, "https://ryot.invalid").pathname;
	return redirectTo !== undefined && pathname !== undefined && /^\/god-mode(?:\/|$)/.test(pathname)
		? { to: redirectTo, action: "enter-god-mode" }
		: { redirectTo, to: "/auth", action: "start-oauth" };
}
