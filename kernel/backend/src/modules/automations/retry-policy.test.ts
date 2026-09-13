import {
	DEFAULT_AUTOMATION_RETRY_POLICY,
	type AutomationFailureKind,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { describe, expect, it } from "vitest";

import { automaticRetryAt, isRetryableAutomationFailure } from "./retry-policy";

const now = new Date("2026-09-15T00:00:00.000Z");
const run = {
	attemptCount: 1,
	stage: "after" as const,
	status: "failed" as const,
	artifactsExpireAt: "2026-10-15T00:00:00.000Z",
	retryPolicy: { ...DEFAULT_AUTOMATION_RETRY_POLICY, maxAttempts: 5, maxDelayMs: 2500 },
};

describe("automation retries", () => {
	it.each([
		["sandbox-timeout", true],
		["sandbox-infrastructure", true],
		["resource-unavailable", true],
		["invalid-input", false],
		["invalid-output", false],
		["missing-artifact", false],
		["business-failure", false],
		["external-uncertain-outcome", false],
	] satisfies [AutomationFailureKind, boolean][])("classifies %s", (kind, retryable) => {
		expect(isRetryableAutomationFailure(kind, run.retryPolicy)).toBe(retryable);
	});
	it("permits uncertain external retries only with the pinned run-id declaration", () => {
		expect(automaticRetryAt(run, "external-uncertain-outcome", now)).toBeNull();
		expect(
			automaticRetryAt(
				{ ...run, retryPolicy: { ...run.retryPolicy, externalIdempotency: "run-id" } },
				"external-uncertain-outcome",
				now,
			)?.getTime(),
		).toBe(now.getTime() + 1000);
	});
	it("caps exponential delays and total automatic attempts and stops before artifact expiry", () => {
		expect(
			[1, 2, 3, 4, 5].map((attemptCount) =>
				automaticRetryAt({ ...run, attemptCount }, "sandbox-timeout", now)?.getTime(),
			),
		).toEqual([
			now.getTime() + 1000,
			now.getTime() + 2000,
			now.getTime() + 2500,
			now.getTime() + 2500,
			undefined,
		]);
		expect(
			automaticRetryAt(
				{ ...run, retryPolicy: DEFAULT_AUTOMATION_RETRY_POLICY },
				"sandbox-timeout",
				now,
			),
		).toBeNull();
		expect(
			automaticRetryAt(
				{ ...run, artifactsExpireAt: new Date(now.getTime() + 1000).toISOString() },
				"sandbox-timeout",
				now,
			),
		).toBeNull();
	});
	it("never retries before policies automatically", () => {
		expect(
			automaticRetryAt({ ...run, stage: "before", retryPolicy: null }, "sandbox-timeout", now),
		).toBeNull();
	});
});
