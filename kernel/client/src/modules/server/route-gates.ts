import type { ServerOrigin } from "#/api/origin";
import { sanitizeRedirect, type SafeRedirect } from "#/modules/server/redirect";

export type RootGateDecision =
	| { readonly action: "redirect"; readonly to: "/auth" }
	| { readonly action: "redirect"; readonly to: "/onboarding" };

export type OnboardingGateDecision =
	| { readonly action: "stay"; readonly redirectTo: SafeRedirect | undefined }
	| {
			readonly to: "/auth";
			readonly action: "redirect";
			readonly redirectTo: SafeRedirect | undefined;
	  };

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
	const redirectTo = sanitizeRedirect(redirectIntent);
	return isNative && server === null
		? { action: "stay", redirectTo }
		: { action: "redirect", redirectTo, to: "/auth" };
}
