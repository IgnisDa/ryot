import { describe, expect, it } from "bun:test";

import { createJob } from "~/lib/test-fixtures";

import type { MediaImportAdapterResult } from "../import-processor";
import { processBookCsvImport, type BookImportProcessorDeps } from "./processor";

const createDeps = (overrides: Partial<BookImportProcessorDeps> = {}): BookImportProcessorDeps => ({
	readImportFile: () => Promise.resolve("csv-data"),
	cleanupImportFile: () => Promise.resolve(),
	processMediaImport: () => Promise.resolve(),
	...overrides,
});

describe("processBookCsvImport", () => {
	it("loads CSV data and delegates to the generic media processor", async () => {
		const cleanedPaths: string[] = [];
		const adapterInputs: string[] = [];
		const adapterResult: MediaImportAdapterResult = { entityGroups: [], failures: [] };

		await processBookCsvImport(
			createJob({}),
			undefined,
			{
				runId: "run_1",
				userId: "user_1",
				importStep: undefined,
				sourceName: "Goodreads",
				filePath: "/tmp/import.csv",
				providerEntityIds: undefined,
				mediaEntityGroups: undefined,
				providerEntityRefs: undefined,
				adapterFailureCount: undefined,
				providerEntityIndex: undefined,
				providerSandboxJobId: undefined,
				mediaWriteGroupIndex: undefined,
				providerFailedIndices: undefined,
				mediaWriteFailedItems: undefined,
				mediaWriteImportedItems: undefined,
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
				processMediaImport: async (_job, _token, input) => {
					expect(input.jobData).toBeUndefined();
					expect(input.sourceName).toBe("Goodreads");
					expect(input.adapterErrorFallback).toBe("Could not parse Goodreads import data");
					expect(await input.loadAdapterResult()).toBe(adapterResult);
					await input.cleanup?.();
				},
			}),
		);

		expect(adapterInputs).toEqual(["csv-data"]);
		expect(cleanedPaths).toEqual(["/tmp/import.csv"]);
	});
});
