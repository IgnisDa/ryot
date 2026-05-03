import { describe, expect, it } from "bun:test";

import type { SandboxEnqueueOptions } from "~/lib/sandbox/types";
import { createSandboxDeps, createSandboxScriptDeps } from "~/lib/test-fixtures";

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
		expect(() => resolveSandboxJobId("   ")).toThrow("Sandbox job id is required");
	});
});

describe("enqueueSandbox", () => {
	it("returns not found when the script is missing", async () => {
		const result = await enqueueSandbox(
			{
				userId: "user_1",
				body: { driverName: "search", scriptId: "script_1" },
			},
			createSandboxDeps(),
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
			createSandboxDeps(),
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
			createSandboxDeps({
				getSandboxScriptForUser: async () => ({
					isBuiltin: true,
					userId: "user_2",
				}),
				enqueueSandboxJob: async (input) => {
					queuedInput = input;
					return { jobId: "job_1" };
				},
			}),
		);

		expect(result).toEqual({ data: { jobId: "job_1" } });
		expect(queuedInput).toMatchObject({
			userId: "user_1",
			scriptId: "script_1",
			driverName: "search",
			context: { source: "test" },
		});
		expect(queuedInput).not.toHaveProperty("code");
		expect(queuedInput).not.toHaveProperty("apiFunctionDescriptors");
	});
});

describe("getSandboxResult", () => {
	it("returns validation when the job id is blank", async () => {
		const result = await getSandboxResult({ jobId: "   ", userId: "user_1" }, createSandboxDeps());

		expect(result).toEqual({
			error: "validation",
			message: "Sandbox job id is required",
		});
	});

	it("returns not found when the job is missing", async () => {
		const result = await getSandboxResult(
			{ jobId: "job_1", userId: "user_1" },
			createSandboxDeps(),
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Sandbox job not found",
		});
	});

	it("returns a normalized completed result", async () => {
		const result = await getSandboxResult(
			{ jobId: "job_1", userId: "user_1" },
			createSandboxDeps({
				getSandboxJobByIdForUser: async () => ({
					jobData: {
						code: "run()",
						userId: "user_1",
						driverName: "main",
						scriptId: "script_1",
					},
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
			}),
		);

		expect(result).toEqual({
			data: {
				error: null,
				value: null,
				logs: "done",
				timing: null,
				status: "completed",
			},
		});
	});

	it("returns a fallback failure when the completed payload is invalid", async () => {
		const result = await getSandboxResult(
			{ jobId: "job_1", userId: "user_1" },
			createSandboxDeps({
				getSandboxJobByIdForUser: async () => ({
					job: {
						data: {},
						returnvalue: { nope: true },
						getState: async () => "completed",
					},
					jobData: {
						code: "run()",
						userId: "user_1",
						driverName: "main",
						scriptId: "script_1",
					},
				}),
			}),
		);

		expect(result).toEqual({
			data: { status: "failed", error: "Sandbox job result unavailable" },
		});
	});
});

describe("createSandboxScript", () => {
	const mockCode = 'driver("main", async function() { return 1; });';

	it("returns validation when the name is blank", async () => {
		const result = await createSandboxScript(
			{ userId: "user_1", body: { name: "   ", code: mockCode } },
			createSandboxScriptDeps(),
		);

		expect(result).toMatchObject({ error: "validation" });
	});

	it("returns validation when a script with the same slug already exists", async () => {
		const result = await createSandboxScript(
			{ userId: "user_1", body: { name: "My Script", code: mockCode } },
			createSandboxScriptDeps({
				getSandboxScriptBySlugForUser: async () => ({ id: "existing_script" }),
				createSandboxScriptForUser: async () => {
					throw new Error("should not be called");
				},
			}),
		);

		expect(result).toEqual({
			error: "validation",
			message: "A sandbox script with this slug already exists",
		});
	});

	it("returns validation when the repository hits the unique constraint", async () => {
		const result = await createSandboxScript(
			{ userId: "user_1", body: { name: "My Script", code: mockCode } },
			createSandboxScriptDeps({
				createSandboxScriptForUser: async () => {
					throw {
						code: "23505",
						constraint: "sandbox_script_user_slug_unique",
					};
				},
			}),
		);

		expect(result).toEqual({
			error: "validation",
			message: "A sandbox script with this slug already exists",
		});
	});

	it("returns the created script on success", async () => {
		const result = await createSandboxScript(
			{ userId: "user_1", body: { name: "My Script", code: mockCode } },
			createSandboxScriptDeps(),
		);

		expect(result).toEqual({
			data: {
				metadata: {},
				id: "script_1",
				code: mockCode,
				name: "My Script",
				slug: "my-script",
			},
		});
	});

	it("stores validated metadata on success", async () => {
		let capturedMetadata: unknown;

		await createSandboxScript(
			{
				userId: "user_1",
				body: {
					code: mockCode,
					name: "My Script",
					metadata: { allowedHostFunctions: ["appApiCall"] },
				},
			},
			createSandboxScriptDeps({
				createSandboxScriptForUser: async (input) => {
					capturedMetadata = input.metadata;
					return {
						id: "script_1",
						code: input.code,
						name: input.name,
						slug: input.slug,
						metadata: input.metadata,
					};
				},
			}),
		);

		expect(capturedMetadata).toEqual({ allowedHostFunctions: ["appApiCall"] });
	});

	it("returns validation when metadata references an unknown host function", async () => {
		const result = await createSandboxScript(
			{
				userId: "user_1",
				body: {
					code: mockCode,
					name: "My Script",
					metadata: { allowedHostFunctions: ["missingFunction"] },
				},
			},
			createSandboxScriptDeps({
				createSandboxScriptForUser: async () => {
					throw new Error("should not be called");
				},
			}),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Unknown sandbox host function: missingFunction",
		});
	});

	it("rethrows unexpected repository failures", async () => {
		expect(
			createSandboxScript(
				{ userId: "user_1", body: { name: "My Script", code: mockCode } },
				createSandboxScriptDeps({
					createSandboxScriptForUser: async () => {
						throw new Error("database offline");
					},
				}),
			),
		).rejects.toThrow("database offline");
	});
});
