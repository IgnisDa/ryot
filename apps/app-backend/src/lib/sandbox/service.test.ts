import { describe, expect, it } from "bun:test";

import { type SandboxRunJobData, sandboxRunJobName } from "./jobs";
import { SandboxService } from "./service";

type TestSandboxExecutor = {
	execute: (options: unknown) => Promise<unknown>;
	executeQueuedRun: (
		jobData: SandboxRunJobData,
		scriptFetcher?: (scriptId: string) => Promise<{ code: string; metadata: object } | null>,
	) => Promise<unknown>;
};

type TestSandboxWorkerProcessor = {
	executeQueuedRun: (jobData: SandboxRunJobData) => Promise<unknown>;
	processJob: (job: { name: string; data: unknown }) => Promise<unknown>;
};

type TestSandboxQueueAccessor = {
	getQueue: () => { getJob: (jobId: string) => Promise<unknown> };
};

const createJobData = (overrides: Partial<SandboxRunJobData> = {}): SandboxRunJobData => ({
	userId: "user_1",
	driverName: "main",
	scriptId: "script_1",
	...overrides,
});

const createScriptFetcher = (metadata?: object) => async (_scriptId: string) => ({
	metadata: metadata ?? {},
	code: 'driver("main", async function() { return 1; });',
});

describe("SandboxService.executeQueuedRun", () => {
	it("returns error when the script is not found", async () => {
		const service = new SandboxService();
		const testService = service as unknown as TestSandboxExecutor;

		const result = await testService.executeQueuedRun(createJobData(), async () => null);

		expect(result).toEqual({
			success: false,
			error: "Sandbox script not found",
		});
	});

	it("builds descriptors from allowedHostFunctions in metadata", async () => {
		const service = new SandboxService();
		const testService = service as unknown as TestSandboxExecutor;
		let capturedOptions: unknown;

		testService.execute = async (options: unknown) => {
			capturedOptions = options;
			return { value: "ok", success: true, logs: null, error: null };
		};

		await testService.executeQueuedRun(
			createJobData({ timeoutMs: 2500, context: { page: 2 } }),
			createScriptFetcher({ allowedHostFunctions: ["getAppConfigValue"] }),
		);

		expect(capturedOptions).toMatchObject({
			timeoutMs: 2500,
			context: { page: 2 },
			code: 'driver("main", async function() { return 1; });',
		});

		const apiFunctions = (
			capturedOptions as {
				apiFunctions: Record<string, (...args: Array<unknown>) => Promise<unknown>>;
			}
		).apiFunctions;
		expect(Object.keys(apiFunctions).sort()).toEqual(["getAppConfigValue"]);
	});

	it("uses no registry functions when metadata has no allowedHostFunctions", async () => {
		const service = new SandboxService();
		const testService = service as unknown as TestSandboxExecutor;
		let capturedOptions: unknown;

		testService.execute = async (options: unknown) => {
			capturedOptions = options;
			return { value: "ok", success: true, logs: null, error: null };
		};

		await testService.executeQueuedRun(createJobData(), createScriptFetcher());

		const apiFunctions = (
			capturedOptions as {
				apiFunctions: Record<string, (...args: Array<unknown>) => Promise<unknown>>;
			}
		).apiFunctions;
		expect(Object.keys(apiFunctions).sort()).toEqual([]);
	});

	it("returns error before execute when metadata is invalid", async () => {
		const service = new SandboxService();
		const testService = service as unknown as TestSandboxExecutor;
		let executeCalled = false;

		testService.execute = async () => {
			executeCalled = true;
			return { success: true };
		};

		const result = await testService.executeQueuedRun(
			createJobData(),
			createScriptFetcher({ allowedHostFunctions: "not-an-array" }),
		);

		expect((result as { success: boolean }).success).toBe(false);
		expect((result as { error: string }).error).toContain("Sandbox script metadata is invalid");
		expect(executeCalled).toBe(false);
	});

	it("returns error before execute when metadata has an unknown function key", async () => {
		const service = new SandboxService();
		const testService = service as unknown as TestSandboxExecutor;
		let executeCalled = false;

		testService.execute = async () => {
			executeCalled = true;
			return { success: true };
		};

		const result = await testService.executeQueuedRun(
			createJobData(),
			createScriptFetcher({ allowedHostFunctions: ["missingFunction"] }),
		);

		expect((result as { success: boolean }).success).toBe(false);
		expect((result as { error: string }).error).toBe(
			"Unknown sandbox host function: missingFunction",
		);
		expect(executeCalled).toBe(false);
	});

	it("forwards driverName in execute payload", async () => {
		const service = new SandboxService();
		const testService = service as unknown as TestSandboxExecutor;
		let capturedOptions: unknown;

		testService.execute = async (options: unknown) => {
			capturedOptions = options;
			return { success: true, logs: null, error: null, value: null };
		};

		await testService.executeQueuedRun(
			createJobData({ driverName: "details" }),
			createScriptFetcher(),
		);

		expect(capturedOptions).toMatchObject({ driverName: "details" });
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

		expect(service.getJobByIdForUser({ jobId: "job_1", userId: "user_1" })).resolves.toEqual({
			job,
			jobData: createJobData(),
		});
	});

	it("returns null when the job does not exist", async () => {
		const service = new SandboxService();
		const testService = service as unknown as TestSandboxQueueAccessor;

		testService.getQueue = () => ({ getJob: async () => null });

		expect(service.getJobByIdForUser({ jobId: "missing", userId: "user_1" })).resolves.toBeNull();
	});

	it("returns null when the job belongs to another user", async () => {
		const service = new SandboxService();
		const testService = service as unknown as TestSandboxQueueAccessor;

		testService.getQueue = () => ({
			getJob: async () => ({ data: createJobData({ userId: "user_2" }) }),
		});

		expect(service.getJobByIdForUser({ jobId: "job_1", userId: "user_1" })).resolves.toBeNull();
	});

	it("returns null when the job payload is invalid", async () => {
		const service = new SandboxService();
		const testService = service as unknown as TestSandboxQueueAccessor;

		testService.getQueue = () => ({
			getJob: async () => ({ data: { userId: "user_1" } }),
		});

		expect(service.getJobByIdForUser({ jobId: "job_1", userId: "user_1" })).resolves.toBeNull();
	});
});

describe("SandboxService worker job processing", () => {
	it("rejects unsupported sandbox jobs", async () => {
		const service = new SandboxService();
		const testService = service as unknown as TestSandboxWorkerProcessor;

		expect(testService.processJob({ name: "unknown", data: {} })).rejects.toThrow(
			"Unsupported sandbox job: unknown",
		);
	});

	it("rejects invalid sandbox job payloads", async () => {
		const service = new SandboxService();
		const testService = service as unknown as TestSandboxWorkerProcessor;

		expect(
			testService.processJob({
				name: sandboxRunJobName,
				data: { userId: "user_1" },
			}),
		).rejects.toThrow("Sandbox run payload is invalid");
	});

	it("routes valid execute jobs through queued execution", async () => {
		const service = new SandboxService();
		const testService = service as unknown as TestSandboxWorkerProcessor;
		let capturedJobData: SandboxRunJobData | undefined;

		testService.executeQueuedRun = async (jobData) => {
			capturedJobData = jobData;
			return { success: true, error: null, logs: null, value: null };
		};

		expect(
			testService.processJob({
				name: sandboxRunJobName,
				data: createJobData({ driverName: "details" }),
			}),
		).resolves.toEqual({ success: true, error: null, logs: null, value: null });

		expect(capturedJobData).toEqual(createJobData({ driverName: "details" }));
	});
});

describe("SandboxService.enqueue", () => {
	it("includes driverName in job data when enqueuing", async () => {
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
		});

		expect(addedJobs).toHaveLength(1);
		const jobData = addedJobs[0]?.data as { driverName?: string } | undefined;
		expect(jobData?.driverName).toBe("search");
	});
});
