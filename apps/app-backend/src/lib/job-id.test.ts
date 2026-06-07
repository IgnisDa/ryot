import { describe, expect, it } from "vitest";

import { createWorkflowJobId, resolveWorkflowExecutionId } from "./job-id";

describe("workflow job ids", () => {
	it("resolves the execution id for the issuing user", () => {
		const secret = "secret";
		const executionId = "run_123";
		const jobId = createWorkflowJobId(secret, executionId, "user_1");

		expect(resolveWorkflowExecutionId(secret, "user_1", jobId)).toBe(executionId);
	});

	it("returns null for a different user", () => {
		const jobId = createWorkflowJobId("secret", "run_123", "user_1");

		expect(resolveWorkflowExecutionId("secret", "user_2", jobId)).toBeNull();
	});

	it("returns null for a tampered job id", () => {
		const secret = "secret";
		const jobId = createWorkflowJobId(secret, "run_123", "user_1");
		const [executionId, signature] = jobId.split(".");
		const tamperedJobId = `${executionId}.x${signature?.slice(1) ?? ""}`;

		expect(resolveWorkflowExecutionId(secret, "user_1", tamperedJobId)).toBeNull();
	});
});
