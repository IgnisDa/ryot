import { describe, expect, it } from "bun:test";

import { createJob } from "~/lib/test-fixtures";

import type { ImportMediaEntityGroup } from "../../jobs";
import { processTraktImport, type TraktImportProcessorDeps } from "./processor";

const createGroup = (externalId: string, sourceLabel: string): ImportMediaEntityGroup => ({
	events: [],
	collectionMemberships: [],
	entityRef: { externalId, sourceLabel, scriptSlug: "movie.tmdb", entitySchemaSlug: "movie" },
});

const createDeps = (
	overrides: Partial<TraktImportProcessorDeps> = {},
): TraktImportProcessorDeps => ({
	getTraktClientId: () => "client_1",
	updateImportRun: () => Promise.resolve(),
	createImportRunFailure: () => Promise.resolve(),
	adaptTraktData: () => Promise.resolve({ entityGroups: [], failures: [] }),
	writeMediaEntityGroups: () => Promise.resolve({ failedItems: 0, importedItems: 0 }),
	populateMediaEntityRefs: () => Promise.resolve({ entityIds: [], failedIndices: [] }),
	...overrides,
});

describe("processTraktImport", () => {
	it("reuses normalized adapter results and counts adapter/provider/write failures once", async () => {
		const groups = [createGroup("tmdb_1", "Movie One"), createGroup("tmdb_2", "Movie Two")];
		const runUpdates: Array<Record<string, unknown>> = [];
		const jobUpdates: Array<Record<string, unknown>> = [];
		const failures: Array<{ itemIndex: number; message: string }> = [];
		let adapterCalls = 0;

		await processTraktImport(
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
				traktUsername: "alice",
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
			},
			createDeps({
				adaptTraktData: () => {
					adapterCalls += 1;
					return Promise.resolve({
						entityGroups: groups,
						failures: [
							{
								itemIndex: 10,
								sourceLabel: "Bad Movie",
								sourceIdentifier: "bad_1",
								message: "Bad source item",
							},
						],
					});
				},
				createImportRunFailure: (input) => {
					failures.push({ itemIndex: input.itemIndex, message: input.message });
					return Promise.resolve();
				},
				populateMediaEntityRefs: (_job, _token, input) => {
					expect(input.mediaEntityGroups).toBe(groups);
					expect(input.adapterFailureCount).toBe(1);
					return Promise.resolve({ entityIds: ["entity_1", null], failedIndices: [1] });
				},
				writeMediaEntityGroups: async (input) => {
					expect(input.failedItems).toBe(0);
					expect(input.importedItems).toBe(0);
					expect(input.startGroupIndex).toBe(0);
					expect(input.entityGroups).toBe(groups);
					expect(input.entityIdsByKey.get("movie|movie.tmdb|tmdb_1")).toBe("entity_1");
					expect(input.entityIdsByKey.has("movie|movie.tmdb|tmdb_2")).toBe(false);
					await input.onGroupComplete({ failedItems: 1, importedItems: 1, nextGroupIndex: 2 });
					return { failedItems: 1, importedItems: 1 };
				},
				updateImportRun: (input) => {
					runUpdates.push(input);
					return Promise.resolve();
				},
			}),
		);

		expect(adapterCalls).toBe(1);
		expect(failures).toEqual([{ itemIndex: 10, message: "Bad source item" }]);
		expect(jobUpdates[0]).toMatchObject({
			adapterFailureCount: 1,
			mediaEntityGroups: groups,
			importStep: "populating_entities",
		});
		expect(jobUpdates[1]).toMatchObject({
			adapterFailureCount: 1,
			mediaEntityGroups: groups,
			providerFailedIndices: [1],
			importStep: "writing_events",
			providerEntityIds: ["entity_1", null],
		});
		expect(jobUpdates[2]).toMatchObject({
			mediaWriteGroupIndex: 2,
			mediaWriteFailedItems: 1,
			mediaWriteImportedItems: 1,
		});
		expect(runUpdates.at(-1)).toMatchObject({
			failedItems: 3,
			importedItems: 1,
			processedItems: 3,
			status: "completed",
		});
	});
});
