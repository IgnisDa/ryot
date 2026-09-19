import { describe, expect, it } from "vitest";

import { createWorkflowJobId, resolveWorkflowJob } from "./job-id";

describe("workflow job ids", () => {
	it("resolves the execution id and lane for the issuing user", () => {
		for (const lane of ["interactive", "background"] as const) {
			const job = { lane, executionId: "run.123:4" };
			const jobId = createWorkflowJobId("secret", job, "user_1");

			expect(resolveWorkflowJob("secret", "user_1", jobId)).toEqual(job);
		}
	});

	it("returns null for a different user", () => {
		const jobId = createWorkflowJobId(
			"secret",
			{ lane: "interactive", executionId: "run_123" },
			"user_1",
		);

		expect(resolveWorkflowJob("secret", "user_2", jobId)).toBeNull();
	});

	it("returns null for a tampered signature", () => {
		const jobId = createWorkflowJobId(
			"secret",
			{ lane: "interactive", executionId: "run_123" },
			"user_1",
		);
		const signatureStart = jobId.lastIndexOf(".") + 1;
		const tamperedJobId = `${jobId.slice(0, signatureStart)}x${jobId.slice(signatureStart + 1)}`;

		expect(resolveWorkflowJob("secret", "user_1", tamperedJobId)).toBeNull();
	});

	it("returns null when the lane is swapped", () => {
		const jobId = createWorkflowJobId(
			"secret",
			{ lane: "background", executionId: "run_123" },
			"user_1",
		);

		expect(
			resolveWorkflowJob("secret", "user_1", jobId.replace("background.", "interactive.")),
		).toBeNull();
	});

	it("returns null for an unknown lane", () => {
		const jobId = createWorkflowJobId(
			"secret",
			{ lane: "background", executionId: "run_123" },
			"user_1",
		);

		expect(
			resolveWorkflowJob("secret", "user_1", jobId.replace("background.", "batch.")),
		).toBeNull();
	});
});
