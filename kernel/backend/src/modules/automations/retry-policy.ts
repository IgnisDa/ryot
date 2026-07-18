import type {
	AutomationFailureKind,
	AutomationRetryPolicy,
	AutomationRun,
} from "@ryot-app/contract/modules/automations/lifecycle";

export const isRetryableAutomationFailure = (
	kind: AutomationFailureKind,
	policy: AutomationRetryPolicy | null,
) => {
	switch (kind) {
		case "sandbox-timeout":
		case "sandbox-infrastructure":
		case "resource-unavailable":
			return true;
		case "external-uncertain-outcome":
			return policy?.externalIdempotency === "run-id";
		case "business-failure":
		case "invalid-input":
		case "invalid-output":
		case "missing-artifact":
			return false;
		default:
			return false;
	}
};

export const automaticRetryAt = (
	run: Pick<AutomationRun, "stage" | "retryPolicy" | "attemptCount" | "artifactsExpireAt">,
	kind: AutomationFailureKind,
	now: Date,
): Date | null => {
	const policy = run.retryPolicy;
	if (
		run.stage === "before" ||
		!policy ||
		run.attemptCount < 1 ||
		run.attemptCount >= policy.maxAttempts ||
		!isRetryableAutomationFailure(kind, policy)
	) {
		return null;
	}
	const delay = Math.min(policy.maxDelayMs, policy.initialDelayMs * 2 ** (run.attemptCount - 1));
	const next = new Date(now.getTime() + delay);
	return next.getTime() < Date.parse(run.artifactsExpireAt) ? next : null;
};

export const manualRetryEligibility = (
	run: Pick<AutomationRun, "stage" | "status" | "artifactsExpireAt">,
	now: Date,
	artifactsAvailable: boolean,
) => {
	if (run.stage === "before") {
		return "before-policy" as const;
	}
	if (run.status !== "failed") {
		return "not-failed" as const;
	}
	if (!(now.getTime() < Date.parse(run.artifactsExpireAt))) {
		return "expired" as const;
	}
	if (!artifactsAvailable) {
		return "missing-artifact" as const;
	}
	return null;
};
