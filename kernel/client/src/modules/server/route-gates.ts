import type { ServerOrigin } from "../../api/origin";
import { sanitizeRedirect, type SafeRedirect } from "./redirect";

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

export const decideRootGate = (server: ServerOrigin | null): RootGateDecision => ({
	action: "redirect",
	to: server === null ? "/onboarding" : "/auth",
});

export function decideOnboardingGate(
	server: ServerOrigin | null,
	redirectIntent: unknown,
): OnboardingGateDecision {
	const redirectTo = sanitizeRedirect(redirectIntent);
	return server === null
		? { action: "stay", redirectTo }
		: { action: "redirect", redirectTo, to: "/auth" };
}
