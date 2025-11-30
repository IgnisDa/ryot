import { describe, expect, it } from "bun:test";

import { createJob } from "~/lib/test-fixtures";

import { processMyanimelistImport, type MyanimelistImportProcessorDeps } from "./processor";

const createInput = () => ({
	runId: "run_1",
	userId: "user_1",
	importStep: undefined,
	providerEntityIds: undefined,
	mediaEntityGroups: undefined,
	filePath: "/tmp/anime.xml.gz",
	providerEntityRefs: undefined,
	resolveEntityIndex: undefined,
	adapterFailureCount: undefined,
	providerEntityIndex: undefined,
	resolveSandboxJobId: undefined,
	mediaWriteGroupIndex: undefined,
	providerSandboxJobId: undefined,
	resolveFailedIndices: undefined,
	resolveCandidateIndex: undefined,
	providerFailedIndices: undefined,
	mediaWriteFailedItems: undefined,
	mediaWriteImportedItems: undefined,
});

const createDeps = (
	overrides: Partial<MyanimelistImportProcessorDeps> = {},
): MyanimelistImportProcessorDeps => ({
	maxFileBytes: 32,
	cleanupImportFile: () => Promise.resolve(),
	adaptMyanimelistExports: () => ({ entityGroups: [], failures: [] }),
	readImportFileBytes: () => Promise.resolve(Bun.gzipSync(new Uint8Array([1, 2, 3]))),
	processMediaImport: async (_job, _token, input) => {
		await input.loadAdapterResult();
	},
	...overrides,
});

describe("processMyanimelistImport", () => {
	it("rejects gzip uploads that inflate past the configured size limit", async () => {
		try {
			await processMyanimelistImport(
				createJob({}),
				undefined,
				createInput(),
				createDeps({
					maxFileBytes: 10,
					readImportFileBytes: () => Promise.resolve(Bun.gzipSync(new Uint8Array(11))),
				}),
			);
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			if (error instanceof Error) {
				expect(error.message).toBe(
					"Import file exceeds maximum allowed size of 10 bytes (file is 11 bytes)",
				);
			}
		}
	});

	it("passes decoded XML through to the adapter", async () => {
		let capturedAnimeXml: string | undefined;

		await processMyanimelistImport(
			createJob({}),
			undefined,
			createInput(),
			createDeps({
				adaptMyanimelistExports: ({ animeXml }) => {
					capturedAnimeXml = animeXml;
					return { entityGroups: [], failures: [] };
				},
				readImportFileBytes: () =>
					Promise.resolve(Bun.gzipSync(new TextEncoder().encode("<anime></anime>"))),
			}),
		);

		expect(capturedAnimeXml).toBe("<anime></anime>");
	});
});
