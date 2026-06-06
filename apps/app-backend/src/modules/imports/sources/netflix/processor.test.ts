import { describe, expect, it } from "bun:test";

import { createJob } from "~/lib/test-fixtures";

import { processNetflixImport, type NetflixImportProcessorDeps } from "./processor";

const createDeps = (
	overrides: Partial<NetflixImportProcessorDeps> = {},
): NetflixImportProcessorDeps => ({
	now: () => "2026-02-10T00:00:00.000Z",
	readImportFile: () => Promise.resolve("csv"),
	cleanupImportFile: () => Promise.resolve(),
	enqueueSandbox: () => Promise.resolve({ data: { jobId: "sandbox_1" } }),
	processMediaImport: () => Promise.resolve(),
	waitForSandboxResult: () => Promise.resolve({ items: [] }),
	adaptNetflixExports: () => Promise.resolve({ entityGroups: [], failures: [] }),
	createQueueEvents: () => {
		throw new Error("queue events should not load during this test");
	},
	getBuiltinSandboxScriptBySlug: (slug) => Promise.resolve({ id: `${slug}_script` }),
	extractImportZipArchive: () =>
		Promise.resolve({
			directoryPath: "/tmp/netflix-extracted",
			entries: [
				{
					fileName: "ViewingActivity.csv",
					filePath: "/tmp/ViewingActivity.csv",
					uncompressedSize: 1,
				},
				{ fileName: "Ratings.csv", filePath: "/tmp/Ratings.csv", uncompressedSize: 1 },
				{ fileName: "MyList.csv", filePath: "/tmp/MyList.csv", uncompressedSize: 1 },
			],
		}),
	...overrides,
});

const createInput = () => ({
	runId: "run_1",
	userId: "user_1",
	filePath: "/tmp/netflix.zip",
	importStep: undefined,
	providerEntityIds: undefined,
	mediaEntityGroups: undefined,
	providerEntityRefs: undefined,
	adapterFailureCount: undefined,
	providerEntityIndex: undefined,
	resolveEntityIndex: undefined,
	mediaWriteGroupIndex: undefined,
	resolveSandboxJobId: undefined,
	providerSandboxJobId: undefined,
	resolveFailedIndices: undefined,
	resolveCandidateIndex: undefined,
	providerFailedIndices: undefined,
	mediaWriteFailedItems: undefined,
	mediaWriteImportedItems: undefined,
});

describe("processNetflixImport", () => {
	it("delegates resumable media jobs without adapter-only sandbox setup", async () => {
		const calls: string[] = [];

		await processNetflixImport(
			createJob({}),
			undefined,
			{
				...createInput(),
				mediaEntityGroups: [],
				providerEntityRefs: [],
				importStep: "populating_entities",
			},
			createDeps({
				createQueueEvents: () => {
					throw new Error("queue events should not load during resume");
				},
				getBuiltinSandboxScriptBySlug: () => {
					throw new Error("sandbox scripts should not load during resume");
				},
				processMediaImport: (_job, _token, input) => {
					calls.push(input.sourceName);
					expect(input.sourceName).toBe("Netflix");
					return Promise.resolve();
				},
			}),
		);

		expect(calls).toEqual(["Netflix"]);
	});
});
