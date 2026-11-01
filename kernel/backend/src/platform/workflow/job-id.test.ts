import { describe, expect, it } from "vitest";

import { createWorkflowJobId, resolveWorkflowJob } from "./job-id";

const resolve = (jobId: string, userId = "user_1") => resolveWorkflowJob("secret", userId, jobId);

describe("workflow job ids", () => {
	it("resolves the execution id for the issuing user", () => {
		const job = { executionId: "run_123" };

		expect(resolve(createWorkflowJobId("secret", job, "user_1"))).toEqual(job);
	});

	it("round-trips an item count", () => {
		const job = { itemCount: 42, executionId: "run_123" };
		const jobId = createWorkflowJobId("secret", job, "user_1");

		expect(jobId.split(".")).toHaveLength(3);
		expect(resolve(jobId)).toEqual(job);
	});

	it("round-trips an execution id containing separators", () => {
		for (const job of [{ executionId: "run.123:4" }, { itemCount: 7, executionId: "run.1.2" }]) {
			expect(resolve(createWorkflowJobId("secret", job, "user_1"))).toEqual(job);
		}
	});

	it("returns null for a different user", () => {
		const jobId = createWorkflowJobId("secret", { executionId: "run_123" }, "user_1");

		expect(resolve(jobId, "user_2")).toBeNull();
	});

	it("returns null for a tampered signature", () => {
		const jobId = createWorkflowJobId("secret", { executionId: "run_123" }, "user_1");
		const signatureStart = jobId.lastIndexOf(".") + 1;
		const tamperedJobId = `${jobId.slice(0, signatureStart)}x${jobId.slice(signatureStart + 1)}`;

		expect(resolve(tamperedJobId)).toBeNull();
	});

	it("returns null when the execution id is changed", () => {
		const jobId = createWorkflowJobId("secret", { itemCount: 3, executionId: "run_123" }, "user_1");

		expect(resolve(jobId.replace("run_123", "run_124"))).toBeNull();
	});

	it("returns null when the item count is changed, removed or added", () => {
		const counted = createWorkflowJobId(
			"secret",
			{ itemCount: 3, executionId: "run_123" },
			"user_1",
		);
		const plain = createWorkflowJobId("secret", { executionId: "run_123" }, "user_1");

		expect(resolve(counted.replace(".3.", ".4."))).toBeNull();
		expect(resolve(counted.replace(".3.", ".."))).toBeNull();
		expect(resolve(plain.replace("run_123..", "run_123.3."))).toBeNull();
	});

	it("returns null for a signed but malformed item count", () => {
		for (const itemCount of [0, -1, 1.5, Number.NaN, 2 ** 60]) {
			const jobId = createWorkflowJobId("secret", { itemCount, executionId: "run_123" }, "user_1");
			expect(resolve(jobId)).toBeNull();
		}
	});

	it("returns null for ids without three segments", () => {
		expect(resolve("run_123.signature")).toBeNull();
		expect(resolve("")).toBeNull();
	});
});
