import { describe, expect, it } from "bun:test";
import type { SandboxRunJobData } from "./jobs";
import { SandboxService } from "./service";

type TestSandboxExecutor = {
	execute: (options: unknown) => Promise<unknown>;
};

type TestSandboxQueueAccessor = {
	getQueue: () => { getJob: (jobId: string) => Promise<unknown> };
};

const createJobData = (
	overrides: Partial<SandboxRunJobData> = {},
): SandboxRunJobData => ({
	userId: "user_1",
	driverName: "main",
	scriptId: "script_1",
	code: 'driver("main", async function() { return 1; });',
	...overrides,
});

describe("SandboxService.executeQueuedRun", () => {
	it("reconstructs bound host functions from descriptors", async () => {
		const service = new SandboxService();
		const testService = service as unknown as TestSandboxExecutor;
		let capturedOptions: unknown;

		testService.execute = async (options: unknown) => {
			capturedOptions = options;
			return {
				value: "ok",
				success: true,
				logs: undefined,
				error: undefined,
			};
		};

		expect(
			service.executeQueuedRun(
				createJobData({
					timeoutMs: 2500,
					context: { page: 2 },
					apiFunctionDescriptors: [
						{ context: {}, functionKey: "getAppConfigValue" },
					],
				}),
			),
		).resolves.toEqual({
			value: "ok",
			success: true,
			logs: undefined,
			error: undefined,
		});

		expect(capturedOptions).toMatchObject({
			timeoutMs: 2500,
			context: { page: 2 },
			code: 'driver("main", async function() { return 1; });',
		});

		const apiFunctions = (
			capturedOptions as {
				apiFunctions: Record<
					string,
					(...args: Array<unknown>) => Promise<unknown>
				>;
			}
		).apiFunctions;
		expect(Object.keys(apiFunctions).sort()).toEqual(["getAppConfigValue"]);
	});

	it("throws before execute when a descriptor uses an unknown function key", async () => {
		const service = new SandboxService();
		const testService = service as unknown as TestSandboxExecutor;
		let executeCalled = false;

		testService.execute = async () => {
			executeCalled = true;
			return { success: true };
		};

		expect(
			service.executeQueuedRun(
				createJobData({
					apiFunctionDescriptors: [
						{ context: {}, functionKey: "missingFunction" },
					],
				}),
			),
		).rejects.toThrow("Unknown sandbox host function: missingFunction");
		expect(executeCalled).toBe(false);
	});

	it("calls execute without extra functions when descriptors are absent", async () => {
		const service = new SandboxService();
		const testService = service as unknown as TestSandboxExecutor;
		let capturedOptions: unknown;

		testService.execute = async (options: unknown) => {
			capturedOptions = options;
			return {
				success: true,
				logs: undefined,
				value: undefined,
				error: undefined,
			};
		};

		await service.executeQueuedRun(createJobData());

		expect(capturedOptions).toMatchObject({
			code: 'driver("main", async function() { return 1; });',
		});
		expect((capturedOptions as { apiFunctions?: unknown }).apiFunctions).toBe(
			undefined,
		);
	});

	it("calls execute without extra functions when descriptors are empty", async () => {
		const service = new SandboxService();
		const testService = service as unknown as TestSandboxExecutor;
		let capturedOptions: unknown;

		testService.execute = async (options: unknown) => {
			capturedOptions = options;
			return {
				success: true,
				logs: undefined,
				value: undefined,
				error: undefined,
			};
		};

		await service.executeQueuedRun(
			createJobData({ apiFunctionDescriptors: [] }),
		);

		expect((capturedOptions as { apiFunctions?: unknown }).apiFunctions).toBe(
			undefined,
		);
	});
});

describe("SandboxService.getJobByIdForUser", () => {
	it("returns the job when it belongs to the user and payload is valid", async () => {
		const service = new SandboxService();
		const testService = service as unknown as TestSandboxQueueAccessor;
		const job = {
			data: createJobData(),
			returnvalue: undefined,
			failedReason: undefined,
			getState: async () => "completed" as const,
		};

		testService.getQueue = () => ({
			getJob: async (jobId: string) => {
				expect(jobId).toBe("job_1");
				return job;
			},
		});

		expect(
			service.getJobByIdForUser({ jobId: "job_1", userId: "user_1" }),
		).resolves.toEqual({ job, jobData: createJobData() });
	});

	it("returns null when the job does not exist", async () => {
		const service = new SandboxService();
		const testService = service as unknown as TestSandboxQueueAccessor;

		testService.getQueue = () => ({ getJob: async () => null });

		expect(
			service.getJobByIdForUser({ jobId: "missing", userId: "user_1" }),
		).resolves.toBeNull();
	});

	it("returns null when the job belongs to another user", async () => {
		const service = new SandboxService();
		const testService = service as unknown as TestSandboxQueueAccessor;

		testService.getQueue = () => ({
			getJob: async () => ({ data: createJobData({ userId: "user_2" }) }),
		});

		expect(
			service.getJobByIdForUser({ jobId: "job_1", userId: "user_1" }),
		).resolves.toBeNull();
	});

	it("returns null when the job payload is invalid", async () => {
		const service = new SandboxService();
		const testService = service as unknown as TestSandboxQueueAccessor;

		testService.getQueue = () => ({
			getJob: async () => ({ data: { userId: "user_1" } }),
		});

		expect(
			service.getJobByIdForUser({ jobId: "job_1", userId: "user_1" }),
		).resolves.toBeNull();
	});
});

describe("SandboxService driverName support", () => {
	it("includes driverName in job data when enqueuing with driverName", async () => {
		const service = new SandboxService();
		const testService = service as unknown as TestSandboxQueueAccessor;
		const addedJobs: Array<{ name: string; data: unknown; opts: unknown }> = [];

		testService.getQueue = () =>
			({
				add: async (name: string, data: unknown, opts: unknown) => {
					addedJobs.push({ name, data, opts });
					return { id: "job_1" };
				},
				getJob: async () => null,
			}) as unknown as ReturnType<TestSandboxQueueAccessor["getQueue"]>;

		await service.enqueue({
			userId: "user_1",
			scriptId: "script_1",
			driverName: "search",
			code: 'driver("search", async function() { return 1; });',
		});

		expect(addedJobs).toHaveLength(1);
		const jobData = addedJobs[0]?.data as { driverName?: string } | undefined;
		expect(jobData?.driverName).toBe("search");
	});

	it("forwards driverName in execute payload", async () => {
		const service = new SandboxService();
		const testService = service as unknown as TestSandboxExecutor;
		let capturedOptions: unknown;

		testService.execute = async (options: unknown) => {
			capturedOptions = options;
			return {
				success: true,
				logs: undefined,
				value: undefined,
				error: undefined,
			};
		};

		await service.executeQueuedRun(createJobData({ driverName: "details" }));

		expect(capturedOptions).toMatchObject({ driverName: "details" });
	});
});
