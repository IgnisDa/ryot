import { describe, expect, it } from "bun:test";
import type { SandboxEnqueueOptions } from "~/lib/sandbox/types";
import {
	enqueueSandbox,
	getSandboxResult,
	resolveSandboxJobId,
} from "./service";

describe("resolveSandboxJobId", () => {
	it("trims the provided job id", () => {
		expect(resolveSandboxJobId("  job_123  ")).toBe("job_123");
	});

	it("throws when the job id is blank", () => {
		expect(() => resolveSandboxJobId("   ")).toThrow(
			"Sandbox job id is required",
		);
	});
});

describe("enqueueSandbox", () => {
	it("returns not found when the script is missing", async () => {
		const result = await enqueueSandbox(
			{
				body: { kind: "script", scriptId: "script_1" },
				userId: "user_1",
			},
			{
				getSandboxJobByIdForUser: async () => null,
				getSandboxScriptForUser: async () => undefined,
				enqueueSandboxJob: async () => ({ jobId: "job_1" }),
			},
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Sandbox script not found",
		});
	});

	it("returns not found when the script belongs to a different user", async () => {
		const result = await enqueueSandbox(
			{ userId: "user_1", body: { kind: "script", scriptId: "script_1" } },
			{
				getSandboxJobByIdForUser: async () => null,
				getSandboxScriptForUser: async () => undefined,
				enqueueSandboxJob: async () => ({ jobId: "job_1" }),
			},
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Sandbox script not found",
		});
	});

	it("enqueues a built-in script even when it has a user id", async () => {
		let queuedInput: SandboxEnqueueOptions | undefined;

		const result = await enqueueSandbox(
			{
				userId: "user_1",
				body: {
					kind: "script",
					scriptId: "script_1",
					context: { source: "test" },
				},
			},
			{
				getSandboxJobByIdForUser: async () => null,
				getSandboxScriptForUser: async () => ({
					isBuiltin: true,
					userId: "user_2",
					code: "runBuiltin()",
				}),
				enqueueSandboxJob: async (input) => {
					queuedInput = input;
					return { jobId: "job_1" };
				},
			},
		);

		expect(result).toEqual({ data: { jobId: "job_1" } });
		expect(queuedInput).toMatchObject({
			userId: "user_1",
			code: "runBuiltin()",
			scriptId: "script_1",
			context: { source: "test" },
			apiFunctionDescriptors: [
				{ context: {}, functionKey: "httpCall" },
				{ context: {}, functionKey: "getAppConfigValue" },
				{ context: { userId: "user_1" }, functionKey: "getEntitySchemas" },
			],
		});
	});

	it("enqueues inline code with API function descriptors", async () => {
		let queuedInput: SandboxEnqueueOptions | undefined;

		const result = await enqueueSandbox(
			{
				userId: "user_1",
				body: { kind: "code", code: "return 1;", context: { source: "test" } },
			},
			{
				enqueueSandboxJob: async (input) => {
					queuedInput = input;
					return { jobId: "job_1" };
				},
				getSandboxJobByIdForUser: async () => null,
				getSandboxScriptForUser: async () => undefined,
			},
		);

		expect(result).toEqual({ data: { jobId: "job_1" } });
		expect(queuedInput).toMatchObject({
			userId: "user_1",
			code: "return 1;",
			context: { source: "test" },
			apiFunctionDescriptors: [
				{ context: {}, functionKey: "httpCall" },
				{ context: {}, functionKey: "getAppConfigValue" },
				{ context: { userId: "user_1" }, functionKey: "getEntitySchemas" },
			],
		});
	});
});

describe("getSandboxResult", () => {
	it("returns validation when the job id is blank", async () => {
		const result = await getSandboxResult(
			{ jobId: "   ", userId: "user_1" },
			{
				getSandboxJobByIdForUser: async () => null,
				getSandboxScriptForUser: async () => undefined,
				enqueueSandboxJob: async () => ({ jobId: "job_1" }),
			},
		);

		expect(result).toEqual({
			error: "validation",
			message: "Sandbox job id is required",
		});
	});

	it("returns not found when the job is missing", async () => {
		const result = await getSandboxResult(
			{ jobId: "job_1", userId: "user_1" },
			{
				getSandboxJobByIdForUser: async () => null,
				getSandboxScriptForUser: async () => undefined,
				enqueueSandboxJob: async () => ({ jobId: "job_1" }),
			},
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Sandbox job not found",
		});
	});

	it("returns a normalized completed result", async () => {
		const result = await getSandboxResult(
			{ jobId: "job_1", userId: "user_1" },
			{
				getSandboxScriptForUser: async () => undefined,
				enqueueSandboxJob: async () => ({ jobId: "job_1" }),
				getSandboxJobByIdForUser: async () => ({
					jobData: { code: "run()", userId: "user_1" },
					job: {
						data: {},
						getState: async () => "completed",
						returnvalue: {
							error: null,
							logs: "done",
							success: true,
							value: undefined,
						},
					},
				}),
			},
		);

		expect(result).toEqual({
			data: { error: null, value: null, logs: "done", status: "completed" },
		});
	});

	it("returns a fallback failure when the completed payload is invalid", async () => {
		const result = await getSandboxResult(
			{ jobId: "job_1", userId: "user_1" },
			{
				getSandboxScriptForUser: async () => undefined,
				enqueueSandboxJob: async () => ({ jobId: "job_1" }),
				getSandboxJobByIdForUser: async () => ({
					jobData: { code: "run()", userId: "user_1" },
					job: {
						data: {},
						returnvalue: { nope: true },
						getState: async () => "completed",
					},
				}),
			},
		);

		expect(result).toEqual({
			data: { status: "failed", error: "Sandbox job result unavailable" },
		});
	});
});
