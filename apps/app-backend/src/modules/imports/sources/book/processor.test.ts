import { describe, expect, it } from "bun:test";

import { createJob } from "~/lib/test-fixtures";

import type { ImportMediaEntityGroup } from "../../jobs";
import { processBookCsvImport, type BookImportProcessorDeps } from "./processor";

const createGroup = (externalId: string, sourceLabel: string): ImportMediaEntityGroup => ({
	events: [],
	collectionMemberships: [],
	entityRef: { externalId, sourceLabel, scriptSlug: "book.openlibrary", entitySchemaSlug: "book" },
});

const createDeps = (overrides: Partial<BookImportProcessorDeps> = {}): BookImportProcessorDeps => ({
	updateImportRun: () => Promise.resolve(),
	cleanupImportFile: () => Promise.resolve(),
	createImportRunFailure: () => Promise.resolve(),
	readImportFile: () => Promise.resolve("csv-data"),
	writeMediaEntityGroups: () => Promise.resolve({ failedItems: 0, importedItems: 0 }),
	populateMediaEntityRefs: () => Promise.resolve({ entityIds: [], failedIndices: [] }),
	...overrides,
});

describe("processBookCsvImport", () => {
	it("reuses the shared media processor path for file-based book imports", async () => {
		const cleanedPaths: string[] = [];
		const runUpdates: Array<Record<string, unknown>> = [];
		const jobUpdates: Array<Record<string, unknown>> = [];
		const failures: Array<{ itemIndex: number; message: string }> = [];
		const groups = [createGroup("OL1W", "Book One")];

		const firstGroup = groups[0];
		if (!firstGroup) {
			throw new Error("Expected first group to exist");
		}

		await processBookCsvImport(
			Object.assign(createJob({}), {
				updateData: (data: Record<string, unknown>) => {
					jobUpdates.push(data);
					return Promise.resolve();
				},
			}),
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
				adapt: () =>
					Promise.resolve({
						entityGroups: groups,
						failures: [{ itemIndex: 9, message: "Bad row", sourceLabel: "Broken" }],
					}),
			},
			createDeps({
				cleanupImportFile: (path) => {
					cleanedPaths.push(path);
					return Promise.resolve();
				},
				createImportRunFailure: (input) => {
					failures.push({ itemIndex: input.itemIndex, message: input.message });
					return Promise.resolve();
				},
				populateMediaEntityRefs: (_job, _token, input) => {
					expect(input.jobData).toEqual({ filePath: "/tmp/import.csv" });
					expect(input.entityRefs).toEqual([firstGroup.entityRef]);
					return Promise.resolve({ entityIds: ["entity_1"], failedIndices: [] });
				},
				writeMediaEntityGroups: async (input) => {
					expect(input.entityGroups).toEqual(groups);
					expect(input.entityIdsByKey.get("book|book.openlibrary|OL1W")).toBe("entity_1");
					await input.onGroupComplete({ failedItems: 0, importedItems: 1, nextGroupIndex: 1 });
					return { failedItems: 0, importedItems: 1 };
				},
				updateImportRun: (input) => {
					runUpdates.push(input);
					return Promise.resolve();
				},
			}),
		);

		expect(failures).toEqual([{ itemIndex: 9, message: "Bad row" }]);
		expect(jobUpdates[0]).toMatchObject({
			adapterFailureCount: 1,
			mediaEntityGroups: groups,
			filePath: "/tmp/import.csv",
			importStep: "populating_entities",
		});
		expect(jobUpdates[1]).toMatchObject({
			importStep: "writing_events",
			providerEntityIds: ["entity_1"],
		});
		expect(jobUpdates[2]).toMatchObject({
			mediaWriteGroupIndex: 1,
			mediaWriteImportedItems: 1,
		});
		expect(runUpdates.at(-1)).toMatchObject({
			failedItems: 1,
			importedItems: 1,
			processedItems: 2,
			status: "completed",
		});
		expect(cleanedPaths).toEqual(["/tmp/import.csv"]);
	});
});
