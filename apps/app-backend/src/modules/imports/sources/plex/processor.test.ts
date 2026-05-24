import { describe, expect, it } from "bun:test";

import { createJob } from "~/lib/test-fixtures";

import { processPlexImport, type PlexImportProcessorDeps } from "./processor";

const createDeps = (overrides: Partial<PlexImportProcessorDeps> = {}): PlexImportProcessorDeps => ({
	processMediaImport: () => Promise.resolve(),
	adaptPlexData: () => Promise.resolve({ entityGroups: [], failures: [] }),
	...overrides,
});

const createInput = (sourcePayload: Record<string, unknown> | undefined) => ({
	sourcePayload,
	runId: "run_1",
	userId: "user_1",
});

describe("processPlexImport", () => {
	it("delegates resumable media jobs without source credentials", async () => {
		const calls: string[] = [];

		await processPlexImport(
			createJob({}),
			undefined,
			{
				...createInput(undefined),
				mediaEntityGroups: [],
				providerEntityRefs: [],
				importStep: "populating_entities",
			},
			createDeps({
				adaptPlexData: () => {
					throw new Error("adapter should not load during resume");
				},
				processMediaImport: async (_job, _token, input) => {
					calls.push(input.sourceName);
					expect(input.sourceName).toBe("Plex");
				},
			}),
		);

		expect(calls).toEqual(["Plex"]);
	});

	it("validates credentials when loading source data", async () => {
		await processPlexImport(
			createJob({}),
			undefined,
			createInput(undefined),
			createDeps({
				processMediaImport: async (_job, _token, input) => {
					expect(() => input.loadAdapterResult()).toThrow("Import job is missing Plex credentials");
				},
			}),
		);
	});
});
