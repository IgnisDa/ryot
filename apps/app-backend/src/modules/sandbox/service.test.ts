import { describe, expect, it } from "bun:test";
import type { SandboxEnqueueOptions } from "~/lib/sandbox/types";
import {
	createSandboxScript,
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
				userId: "user_1",
				body: { driverName: "search", scriptId: "script_1" },
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
			{
				userId: "user_1",
				body: { driverName: "search", scriptId: "script_1" },
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

	it("enqueues a built-in script even when it has a user id", async () => {
		let queuedInput: SandboxEnqueueOptions | undefined;

		const result = await enqueueSandbox(
			{
				userId: "user_1",
				body: {
					scriptId: "script_1",
					driverName: "search",
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
				{ context: { userId: "user_1" }, functionKey: "executeQuery" },
				{ context: { userId: "user_1" }, functionKey: "getUserPreferences" },
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
					jobData: { code: "run()", driverName: "main", userId: "user_1" },
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
					jobData: { code: "run()", driverName: "main", userId: "user_1" },
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

describe("createSandboxScript", () => {
	const mockCreated = {
		id: "script_1",
		name: "My Script",
		slug: "my-script",
		code: 'driver("main", async function() { return 1; });',
	};

	it("returns validation when the name is blank", async () => {
		const result = await createSandboxScript(
			{
				userId: "user_1",
				body: { name: "   ", code: mockCreated.code },
			},
			{
				createSandboxScriptForUser: async () => mockCreated,
				getSandboxScriptBySlugForUser: async () => undefined,
			},
		);

		expect(result).toMatchObject({ error: "validation" });
	});

	it("returns validation when a script with the same slug already exists", async () => {
		const result = await createSandboxScript(
			{
				userId: "user_1",
				body: { name: "My Script", code: mockCreated.code },
			},
			{
				getSandboxScriptBySlugForUser: async () => ({ id: "existing_script" }),
				createSandboxScriptForUser: async () => {
					throw new Error("should not be called");
				},
			},
		);

		expect(result).toEqual({
			error: "validation",
			message: "A sandbox script with this slug already exists",
		});
	});

	it("returns the created script on success", async () => {
		const result = await createSandboxScript(
			{
				userId: "user_1",
				body: { name: "My Script", code: mockCreated.code },
			},
			{
				createSandboxScriptForUser: async () => mockCreated,
				getSandboxScriptBySlugForUser: async () => undefined,
			},
		);

		expect(result).toEqual({ data: mockCreated });
	});
});
