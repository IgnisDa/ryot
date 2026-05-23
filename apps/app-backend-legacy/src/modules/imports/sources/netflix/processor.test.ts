import { describe, expect, it } from "bun:test";

import { WaitingChildrenError } from "bullmq";

import { createJob } from "~/lib/test-fixtures";

import { processNetflixImport, type NetflixImportProcessorDeps } from "./processor";

const createDeps = (
	overrides: Partial<NetflixImportProcessorDeps> = {},
): NetflixImportProcessorDeps => ({
	now: () => "2026-02-10T00:00:00.000Z",
	readImportFile: () => Promise.resolve("csv"),
	cleanupImportFile: () => Promise.resolve(),
	processMediaImport: () => Promise.resolve(),
	adaptNetflixExports: () => Promise.resolve({ entityGroups: [], failures: [] }),
	queueSandboxChildJobsBatch: () => Promise.resolve(),
	getSandboxChildRunResults: () => Promise.resolve({}),
	waitForSandboxChildRun: () => Promise.resolve(),
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
	netflixSearchJobs: undefined,
	netflixMyListPath: undefined,
	netflixRatingsPath: undefined,
	netflixViewingActivityPath: undefined,
	netflixExtractedDirectoryPath: undefined,
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
				queueSandboxChildJobsBatch: () => {
					throw new Error("sandbox search jobs should not queue during resume");
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

	it("queues sandbox child searches during adapter loading and parks the import job", async () => {
		let queuedChildren:
			| Array<{ childJobId: string; sandboxJobData: Record<string, unknown> }>
			| undefined;
		let queuedJobData: Record<string, unknown> | undefined;

		try {
			await processNetflixImport(
				createJob({}),
				"token_1",
				createInput(),
				createDeps({
					adaptNetflixExports: async (_input, deps) => {
						if (!deps) {
							throw new Error("Netflix adapter deps are missing");
						}

						await deps.lookupTitle({ title: "The Matrix" });
						return { entityGroups: [], failures: [] };
					},
					queueSandboxChildJobsBatch: (input) => {
						queuedChildren = input.children;
						queuedJobData = input.jobData;
						return Promise.resolve();
					},
					waitForSandboxChildRun: () => Promise.reject(new WaitingChildrenError()),
					processMediaImport: async (job, token, input) => {
						await input.loadAdapterResult();
						await Promise.resolve([job, token]);
					},
				}),
			);
			throw new Error("Expected WaitingChildrenError");
		} catch (error) {
			expect(error).toBeInstanceOf(WaitingChildrenError);
		}

		expect(queuedChildren).toHaveLength(2);
		expect(queuedChildren?.map((child) => child.sandboxJobData.driverName)).toEqual([
			"search",
			"search",
		]);
		expect(queuedJobData).toMatchObject({ importStep: "loading_adapter" });
		const netflixSearchJobs = queuedJobData?.netflixSearchJobs;
		expect(netflixSearchJobs && typeof netflixSearchJobs === "object").toBe(true);
		if (!netflixSearchJobs || typeof netflixSearchJobs !== "object") {
			throw new Error("Expected queued netflix search jobs");
		}
		expect(Object.keys(netflixSearchJobs)).toHaveLength(2);
	});
});
