import { describe, expect, it } from "bun:test";

import { type QueuedRunResult, type SandboxRunJobData, sandboxRunJobName } from "./jobs";
import { type SandboxExecutionOptions, SandboxService } from "./service";

type TestSandboxExecutor = {
	execute: (options: SandboxExecutionOptions) => Promise<unknown>;
	executeQueuedRun: (
		jobData: SandboxRunJobData,
		scriptFetcher?: (scriptId: string) => Promise<{ code: string; metadata: object } | null>,
	) => Promise<QueuedRunResult>;
};

type TestSandboxWorkerProcessor = {
	executeQueuedRun: (jobData: SandboxRunJobData) => Promise<unknown>;
	processJob: (job: { name: string; data: unknown }) => Promise<unknown>;
};

type TestSandboxQueueAccessor = {
	getQueue: () => {
		add?: (name: string, data: unknown, opts: unknown) => Promise<{ id: string }>;
		getJob: (jobId: string) => Promise<unknown>;
	};
};

const createJobData = (overrides: Partial<SandboxRunJobData> = {}): SandboxRunJobData => ({
	userId: "user_1",
	driverName: "main",
	scriptId: "script_1",
	...overrides,
});

const createScriptFetcher = (metadata?: object) => (_scriptId: string) =>
	Promise.resolve({
		metadata: metadata ?? {},
		code: 'driver("main", async function() { return 1; });',
	});

describe("SandboxService.executeQueuedRun", () => {
	it("returns error when the script is not found", async () => {
		const service = new SandboxService();
		// oxlint-disable-next-line no-unsafe-type-assertion
		const testService = service as unknown as TestSandboxExecutor;

		const result = await testService.executeQueuedRun(createJobData(), () => Promise.resolve(null));

		expect(result).toEqual({
			success: false,
			error: "Sandbox script not found",
		});
	});

	it("builds descriptors from allowedHostFunctions in metadata", async () => {
		const service = new SandboxService();
		// oxlint-disable-next-line no-unsafe-type-assertion
		const testService = service as unknown as TestSandboxExecutor;
		let capturedOptions: SandboxExecutionOptions | undefined;

		testService.execute = (options) => {
			capturedOptions = options;
			return Promise.resolve({ value: "ok", success: true, logs: null, error: null });
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

		const apiFunctions = capturedOptions?.apiFunctions ?? {};
		expect(Object.keys(apiFunctions).toSorted()).toEqual(["getAppConfigValue"]);
	});

	it("uses no registry functions when metadata has no allowedHostFunctions", async () => {
		const service = new SandboxService();
		// oxlint-disable-next-line no-unsafe-type-assertion
		const testService = service as unknown as TestSandboxExecutor;
		let capturedOptions: SandboxExecutionOptions | undefined;

		testService.execute = (options) => {
			capturedOptions = options;
			return Promise.resolve({ value: "ok", success: true, logs: null, error: null });
		};

		await testService.executeQueuedRun(createJobData(), createScriptFetcher());

		const apiFunctions = capturedOptions?.apiFunctions ?? {};
		expect(Object.keys(apiFunctions).toSorted()).toEqual([]);
	});

	it("returns error before execute when metadata is invalid", async () => {
		const service = new SandboxService();
		// oxlint-disable-next-line no-unsafe-type-assertion
		const testService = service as unknown as TestSandboxExecutor;
		let executeCalled = false;

		testService.execute = () => {
			executeCalled = true;
			return Promise.resolve({ success: true });
		};

		const result = await testService.executeQueuedRun(
			createJobData(),
			createScriptFetcher({ allowedHostFunctions: "not-an-array" }),
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain("Sandbox script metadata is invalid");
		expect(executeCalled).toBe(false);
	});

	it("returns error before execute when metadata has an unknown function key", async () => {
		const service = new SandboxService();
		// oxlint-disable-next-line no-unsafe-type-assertion
		const testService = service as unknown as TestSandboxExecutor;
		let executeCalled = false;

		testService.execute = () => {
			executeCalled = true;
			return Promise.resolve({ success: true });
		};

		const result = await testService.executeQueuedRun(
			createJobData(),
			createScriptFetcher({ allowedHostFunctions: ["missingFunction"] }),
		);

		expect(result.success).toBe(false);
		expect(result.error).toBe("Unknown sandbox host function: missingFunction");
		expect(executeCalled).toBe(false);
	});

	it("forwards driverName in execute payload", async () => {
		const service = new SandboxService();
		// oxlint-disable-next-line no-unsafe-type-assertion
		const testService = service as unknown as TestSandboxExecutor;
		let capturedOptions: SandboxExecutionOptions | undefined;

		testService.execute = (options) => {
			capturedOptions = options;
			return Promise.resolve({ value: "ok", success: true, logs: null, error: null });
		};

		await testService.executeQueuedRun(
			createJobData({ driverName: "details" }),
			createScriptFetcher(),
		);

		expect(capturedOptions).toMatchObject({ driverName: "details" });
	});
});

describe("SandboxService.getJobByIdForUser", () => {
	it("returns the job when it belongs to the user and payload is valid", () => {
		const service = new SandboxService();
		// oxlint-disable-next-line no-unsafe-type-assertion
		const testService = service as unknown as TestSandboxQueueAccessor;
		const job = {
			data: createJobData(),
			returnvalue: undefined,
			failedReason: undefined,
			getState: () => Promise.resolve("completed" as const),
		};

		testService.getQueue = () => ({
			getJob: (jobId: string) => {
				expect(jobId).toBe("job_1");
				return Promise.resolve(job);
			},
		});

		return expect(service.getJobByIdForUser({ jobId: "job_1", userId: "user_1" })).resolves.toEqual(
			{
				job,
				jobData: createJobData(),
			},
		);
	});

	it("returns null when the job does not exist", () => {
		const service = new SandboxService();
		// oxlint-disable-next-line no-unsafe-type-assertion
		const testService = service as unknown as TestSandboxQueueAccessor;

		testService.getQueue = () => ({ getJob: () => Promise.resolve(null) });

		return expect(
			service.getJobByIdForUser({ jobId: "missing", userId: "user_1" }),
		).resolves.toBeNull();
	});

	it("returns null when the job belongs to another user", () => {
		const service = new SandboxService();
		// oxlint-disable-next-line no-unsafe-type-assertion
		const testService = service as unknown as TestSandboxQueueAccessor;

		testService.getQueue = () => ({
			getJob: () => Promise.resolve({ data: createJobData({ userId: "user_2" }) }),
		});

		return expect(
			service.getJobByIdForUser({ jobId: "job_1", userId: "user_1" }),
		).resolves.toBeNull();
	});

	it("returns null when the job payload is invalid", () => {
		const service = new SandboxService();
		// oxlint-disable-next-line no-unsafe-type-assertion
		const testService = service as unknown as TestSandboxQueueAccessor;

		testService.getQueue = () => ({
			getJob: () => Promise.resolve({ data: { userId: "user_1" } }),
		});

		return expect(
			service.getJobByIdForUser({ jobId: "job_1", userId: "user_1" }),
		).resolves.toBeNull();
	});
});

describe("SandboxService worker job processing", () => {
	it("rejects unsupported sandbox jobs", () => {
		const service = new SandboxService();
		// oxlint-disable-next-line no-unsafe-type-assertion
		const testService = service as unknown as TestSandboxWorkerProcessor;

		return expect(testService.processJob({ name: "unknown", data: {} })).rejects.toThrow(
			"Unsupported sandbox job: unknown",
		);
	});

	it("rejects invalid sandbox job payloads", () => {
		const service = new SandboxService();
		// oxlint-disable-next-line no-unsafe-type-assertion
		const testService = service as unknown as TestSandboxWorkerProcessor;

		return expect(
			testService.processJob({
				name: sandboxRunJobName,
				data: { userId: "user_1" },
			}),
		).rejects.toThrow("Sandbox run payload is invalid");
	});

	it("routes valid execute jobs through queued execution", () => {
		const service = new SandboxService();
		// oxlint-disable-next-line no-unsafe-type-assertion
		const testService = service as unknown as TestSandboxWorkerProcessor;
		let capturedJobData: SandboxRunJobData | undefined;

		testService.executeQueuedRun = (jobData) => {
			capturedJobData = jobData;
			return Promise.resolve({ success: true, error: null, logs: null, value: null });
		};

		const promise = expect(
			testService.processJob({
				name: sandboxRunJobName,
				data: createJobData({ driverName: "details" }),
			}),
		).resolves.toEqual({ success: true, error: null, logs: null, value: null });

		expect(capturedJobData).toEqual(createJobData({ driverName: "details" }));
		return promise;
	});
});

describe("SandboxService.enqueue", () => {
	it("includes driverName in job data when enqueuing", async () => {
		const service = new SandboxService();
		// oxlint-disable-next-line no-unsafe-type-assertion
		const testService = service as unknown as TestSandboxQueueAccessor;
		const addedJobs: Array<{ name: string; data: unknown; opts: unknown }> = [];

		testService.getQueue = () => ({
			getJob: () => Promise.resolve(null),
			add: (name: string, data: unknown, opts: unknown) => {
				addedJobs.push({ name, data, opts });
				return Promise.resolve({ id: "job_1" });
			},
		});

		await service.enqueue({
			userId: "user_1",
			scriptId: "script_1",
			driverName: "search",
		});

		expect(addedJobs).toHaveLength(1);
		expect(addedJobs[0]?.data).toMatchObject({ driverName: "search" });
	});
});
