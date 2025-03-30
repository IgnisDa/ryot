import { describe, expect, it } from "bun:test";
import { apiSuccess } from "~/lib/sandbox/types";
import type { SandboxRunJobData } from "./jobs";
import { SandboxService } from "./service";

type TestSandboxExecutor = {
	execute: (options: unknown) => Promise<unknown>;
};

const createJobData = (
	overrides: Partial<SandboxRunJobData> = {},
): SandboxRunJobData => ({
	userId: "user_1",
	code: "return 1;",
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
						{ context: {}, functionKey: "getUserConfigValue" },
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
			userId: "user_1",
			code: "return 1;",
			context: { page: 2 },
		});

		const apiFunctions = (
			capturedOptions as {
				apiFunctions: Record<
					string,
					(...args: Array<unknown>) => Promise<unknown>
				>;
			}
		).apiFunctions;
		expect(Object.keys(apiFunctions).sort()).toEqual([
			"getAppConfigValue",
			"getUserConfigValue",
		]);
		const getUserConfigValue = apiFunctions.getUserConfigValue;
		expect(getUserConfigValue).toBeDefined();
		if (!getUserConfigValue) {
			throw new Error("Expected getUserConfigValue to be bound");
		}

		expect(getUserConfigValue("pageSize")).resolves.toEqual(apiSuccess(20));
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
			userId: "user_1",
			code: "return 1;",
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
