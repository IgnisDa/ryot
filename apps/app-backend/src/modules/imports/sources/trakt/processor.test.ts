import { describe, expect, it } from "bun:test";

import { createJob } from "~/lib/test-fixtures";

import { processTraktImport, type TraktImportProcessorDeps } from "./processor";

const createDeps = (
	overrides: Partial<TraktImportProcessorDeps> = {},
): TraktImportProcessorDeps => ({
	getTraktClientId: () => "client_1",
	updateImportRun: () => Promise.resolve(),
	adaptTraktData: () => Promise.resolve({ entityGroups: [], failures: [] }),
	processMediaImport: () => Promise.resolve(),
	...overrides,
});

const createInput = (sourcePayload: Record<string, unknown> | undefined) => ({
	runId: "run_1",
	userId: "user_1",
	sourcePayload,
	importStep: undefined,
	providerEntityIds: undefined,
	mediaEntityGroups: undefined,
	providerEntityRefs: undefined,
	adapterFailureCount: undefined,
	providerEntityIndex: undefined,
	mediaWriteGroupIndex: undefined,
	providerSandboxJobId: undefined,
	mediaWriteFailedItems: undefined,
	providerFailedIndices: undefined,
	mediaWriteImportedItems: undefined,
});

describe("processTraktImport", () => {
	it("loads Trakt data and delegates to the generic media processor", async () => {
		const adapterCalls: Array<{ username: string; clientId: string }> = [];

		await processTraktImport(
			createJob({}),
			undefined,
			createInput({ username: " alice " }),
			createDeps({
				adaptTraktData: (username, clientId) => {
					adapterCalls.push({ username, clientId });
					return Promise.resolve({ entityGroups: [], failures: [] });
				},
				processMediaImport: async (_job, _token, input) => {
					expect(input.jobData).toEqual({ sourcePayload: { username: "alice" } });
					expect(input.sourceName).toBe("Trakt");
					expect(input.adapterErrorFallback).toBe("Failed to fetch data from Trakt");
					expect(await input.loadAdapterResult()).toEqual({ entityGroups: [], failures: [] });
				},
			}),
		);

		expect(adapterCalls).toEqual([{ username: "alice", clientId: "client_1" }]);
	});

	it("marks the run failed when the source payload is missing the username", async () => {
		const runUpdates: Array<Record<string, unknown>> = [];
		let processorCalls = 0;

		await processTraktImport(
			createJob({}),
			undefined,
			createInput(undefined),
			createDeps({
				updateImportRun: (input) => {
					runUpdates.push(input);
					return Promise.resolve();
				},
				processMediaImport: () => {
					processorCalls += 1;
					return Promise.resolve();
				},
			}),
		);

		expect(processorCalls).toBe(0);
		expect(runUpdates).toEqual([
			{
				runId: "run_1",
				status: "failed",
				finishedAt: expect.any(Date),
				errorSummary: "Import job is missing Trakt username",
			},
		]);
	});
});
