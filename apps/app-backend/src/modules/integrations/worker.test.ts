import { describe, expect, it } from "bun:test";

import { createJob } from "~/lib/test-fixtures";

import { makeSinkIntegration } from "./providers/sink/test-utils";
import { createProcessSinkIntegration } from "./worker";

describe("createProcessSinkIntegration", () => {
	it("updates lastFinishedAt after a successful sink run and preserves webhook job data", async () => {
		const jobUpdates: Array<Record<string, unknown>> = [];
		const runUpdates: Array<Record<string, unknown>> = [];
		const autoDisableCalls: Array<Record<string, unknown>> = [];
		const integrationUpdates: Array<Record<string, unknown>> = [];

		const processSinkIntegration = createProcessSinkIntegration({
			failImportRun: () => Promise.resolve(),
			getImportRunById: async () => Promise.resolve({ status: "completed" as const }),
			parseSinkAdapterResult: async () => Promise.resolve({ failures: [], entityGroups: [] }),
			getIntegrationByIdAnyUser: async () =>
				Promise.resolve(
					makeSinkIntegration({ provider: "kodi", providerSpecifics: { kind: "kodi" } }),
				),
			updateIntegrationRow: async (input) => {
				integrationUpdates.push(input);
				return Promise.resolve(makeSinkIntegration());
			},
			updateImportRun: async (input) => {
				runUpdates.push(input);
				return Promise.resolve();
			},
			checkAndAutoDisable: async (input) => {
				autoDisableCalls.push(input);
				return Promise.resolve();
			},
			processMediaImport: async (job, _token, input) => {
				expect(input.writeContext).toEqual({
					importRunId: "run_1",
					origin: "integration",
					integrationId: "int_1",
				});
				await input.loadAdapterResult();
				await job.updateData({
					runId: "run_1",
					userId: "user_1",
					mediaEntityGroups: [],
					adapterFailureCount: 0,
					importStep: "resolving_entities",
				});
			},
		});

		const job = Object.assign(
			createJob({
				rawBody: "{}",
				runId: "run_1",
				userId: "user_1",
				integrationId: "int_1",
				contentType: "application/json",
			}),
			{
				updateData: (data: Record<string, unknown>) => {
					jobUpdates.push(data);
					return Promise.resolve();
				},
			},
		);

		await processSinkIntegration(job, "user_1", "int_1", "run_1", "{}", "application/json");

		expect(runUpdates[0]).toMatchObject({
			runId: "run_1",
			status: "running",
			startedAt: expect.any(Date),
		});
		expect(jobUpdates[0]).toMatchObject({
			runId: "run_1",
			userId: "user_1",
			integrationId: "int_1",
			importStep: "resolving_entities",
		});
		expect(jobUpdates[0]).not.toHaveProperty("rawBody");
		expect(jobUpdates[0]).not.toHaveProperty("contentType");
		expect(integrationUpdates).toHaveLength(1);
		expect(integrationUpdates[0]).toMatchObject({
			id: "int_1",
			userId: "user_1",
			lastFinishedAt: expect.any(Date),
		});
		expect(autoDisableCalls).toEqual([{ integrationId: "int_1", userId: "user_1" }]);
	});

	it("marks the run failed when the sink parser returns only failures", async () => {
		let lastFinishedUpdated = false;
		let errorSummary: string | undefined;
		const autoDisableCalls: Array<Record<string, unknown>> = [];

		const processSinkIntegration = createProcessSinkIntegration({
			updateImportRun: () => Promise.resolve(),
			getImportRunById: async () => Promise.resolve({ status: "failed" as const }),
			getIntegrationByIdAnyUser: async () =>
				Promise.resolve(
					makeSinkIntegration({
						provider: "generic_json",
						providerSpecifics: { kind: "generic_json" },
					}),
				),
			failImportRun: async (_runId, summary) => {
				errorSummary = summary;
				return Promise.resolve();
			},
			updateIntegrationRow: () => {
				lastFinishedUpdated = true;
				return Promise.resolve(makeSinkIntegration());
			},
			checkAndAutoDisable: async (input) => {
				autoDisableCalls.push(input);
				return Promise.resolve();
			},
			parseSinkAdapterResult: async () =>
				Promise.resolve({
					entityGroups: [],
					failures: [
						{
							itemIndex: 0,
							stage: "source_fetch",
							message: "Generic JSON integration is not implemented in V2 yet",
						},
					],
				}),
			processMediaImport: async (_job, _token, input) => {
				await input.loadAdapterResult();
			},
		});

		await processSinkIntegration(
			createJob({
				rawBody: "{}",
				runId: "run_1",
				userId: "user_1",
				integrationId: "int_1",
				contentType: "application/json",
			}),
			"user_1",
			"int_1",
			"run_1",
			"{}",
			"application/json",
		);

		expect(errorSummary).toBe("Generic JSON integration is not implemented in V2 yet");
		expect(lastFinishedUpdated).toBe(false);
		expect(autoDisableCalls).toEqual([{ integrationId: "int_1", userId: "user_1" }]);
	});
});
