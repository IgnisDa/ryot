import { describe, expect, it } from "vitest";

import { createSandboxJobId, resolveSandboxExecutionId } from "./job-id";

describe("sandbox job ids", () => {
	it("resolves the execution id for the issuing user", () => {
		const secret = "secret";
		const executionId = "run_123";
		const jobId = createSandboxJobId(secret, executionId, "user_1");

		expect(resolveSandboxExecutionId(secret, "user_1", jobId)).toBe(executionId);
	});

	it("returns null for a different user", () => {
		const jobId = createSandboxJobId("secret", "run_123", "user_1");

		expect(resolveSandboxExecutionId("secret", "user_2", jobId)).toBeNull();
	});

	it("returns null for a tampered job id", () => {
		const secret = "secret";
		const jobId = createSandboxJobId(secret, "run_123", "user_1");
		const [executionId, signature] = jobId.split(".");
		const tamperedJobId = `${executionId}.x${signature?.slice(1) ?? ""}`;

		expect(resolveSandboxExecutionId(secret, "user_1", tamperedJobId)).toBeNull();
	});
});
