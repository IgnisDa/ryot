import { describe, expect, it } from "bun:test";

import type { WorkoutAdapterResult } from "./domain";
import { processWorkoutCsvImport, type WorkoutCsvImportProcessorDeps } from "./import-processor";

const adapterResult: WorkoutAdapterResult = { items: [], failures: [] };

const createDeps = (
	overrides: Partial<WorkoutCsvImportProcessorDeps> = {},
): WorkoutCsvImportProcessorDeps => ({
	readImportFile: () => Promise.resolve("csv-data"),
	updateImportRun: () => Promise.resolve(),
	cleanupImportFile: () => Promise.resolve(),
	processWorkoutImportResult: () => Promise.resolve(),
	...overrides,
});

describe("processWorkoutCsvImport", () => {
	it("loads CSV data and delegates to the shared workout result processor", async () => {
		const cleanedPaths: string[] = [];
		const adapterInputs: string[] = [];
		const processedInputs: Array<Record<string, unknown>> = [];

		await processWorkoutCsvImport(
			{
				runId: "run_1",
				userId: "user_1",
				sourceName: "Hevy",
				filePath: "/tmp/hevy.csv",
				adapt: (csvText) => {
					adapterInputs.push(csvText);
					return adapterResult;
				},
			},
			createDeps({
				cleanupImportFile: (path) => {
					cleanedPaths.push(path);
					return Promise.resolve();
				},
				processWorkoutImportResult: (input) => {
					processedInputs.push(input);
					return Promise.resolve();
				},
			}),
		);

		expect(adapterInputs).toEqual(["csv-data"]);
		expect(cleanedPaths).toEqual(["/tmp/hevy.csv"]);
		expect(processedInputs).toEqual([{ runId: "run_1", userId: "user_1", adapterResult }]);
	});

	it("marks the run failed when the adapter cannot parse the CSV", async () => {
		const cleanedPaths: string[] = [];
		const runUpdates: Array<Record<string, unknown>> = [];
		let processorCalls = 0;

		await processWorkoutCsvImport(
			{
				runId: "run_1",
				userId: "user_1",
				filePath: "/tmp/strong.csv",
				sourceName: "StrongApp",
				adapt: () => {
					throw new Error("Bad columns");
				},
			},
			createDeps({
				cleanupImportFile: (path) => {
					cleanedPaths.push(path);
					return Promise.resolve();
				},
				updateImportRun: (input) => {
					runUpdates.push(input);
					return Promise.resolve();
				},
				processWorkoutImportResult: () => {
					processorCalls += 1;
					return Promise.resolve();
				},
			}),
		);

		expect(processorCalls).toBe(0);
		expect(cleanedPaths).toEqual(["/tmp/strong.csv"]);
		expect(runUpdates).toEqual([
			{
				runId: "run_1",
				status: "failed",
				finishedAt: expect.any(Date),
				errorSummary: "Bad columns",
			},
		]);
	});
});
