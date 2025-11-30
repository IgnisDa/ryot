import type { Job } from "bullmq";

import {
	processMediaImport,
	type MediaImportAdapterResult,
	type MediaImportJobInput,
} from "../../media/import-processor";
import {
	cleanupImportFile,
	getValidatedOptionalPath,
	readImportFileBytes,
} from "../../runtime/files";
import { adaptMyanimelistExports } from "./adapter";

const MYANIMELIST_EXTENSIONS = ["gz", "xml"];

type MyanimelistImportProcessorDeps = {
	cleanupImportFile: typeof cleanupImportFile;
	processMediaImport: typeof processMediaImport;
	readImportFileBytes: typeof readImportFileBytes;
	adaptMyanimelistExports: typeof adaptMyanimelistExports;
};

const myanimelistImportProcessorDeps: MyanimelistImportProcessorDeps = {
	cleanupImportFile,
	processMediaImport,
	readImportFileBytes,
	adaptMyanimelistExports,
};

const decodeMyanimelistFile = async (
	filePath: string,
	deps: MyanimelistImportProcessorDeps,
): Promise<string> => {
	const bytes = await deps.readImportFileBytes(filePath);
	const decodedBytes = filePath.toLowerCase().endsWith(".gz")
		? Bun.gunzipSync(new Uint8Array(bytes))
		: bytes;
	return new TextDecoder().decode(decodedBytes);
};

export const processMyanimelistImport = async (
	job: Job,
	token: string | undefined,
	input: MediaImportJobInput & { filePath?: string; sourcePayload?: Record<string, unknown> },
	deps: MyanimelistImportProcessorDeps = myanimelistImportProcessorDeps,
): Promise<void> => {
	const animeFilePath = getValidatedOptionalPath(
		input.sourcePayload?.animeFilePath,
		MYANIMELIST_EXTENSIONS,
	);
	const mangaFilePath = getValidatedOptionalPath(
		input.sourcePayload?.mangaFilePath,
		MYANIMELIST_EXTENSIONS,
	);
	const primaryFilePath = animeFilePath ?? mangaFilePath ?? input.filePath;
	const resolvedAnimeFilePath = animeFilePath ?? (mangaFilePath ? undefined : primaryFilePath);
	const cleanupPaths = [primaryFilePath, resolvedAnimeFilePath, mangaFilePath].filter(
		(filePath): filePath is string => Boolean(filePath),
	);

	await deps.processMediaImport(job, token, {
		...input,
		sourceName: "MyAnimeList",
		adapterErrorFallback: "Could not parse MyAnimeList export data",
		cleanup: async () => {
			for (const filePath of new Set(cleanupPaths)) {
				// oxlint-disable-next-line no-await-in-loop
				await deps.cleanupImportFile(filePath);
			}
		},
		loadAdapterResult: async (): Promise<MediaImportAdapterResult> => {
			const animeXml = resolvedAnimeFilePath
				? await decodeMyanimelistFile(resolvedAnimeFilePath, deps)
				: undefined;
			const mangaXml = mangaFilePath ? await decodeMyanimelistFile(mangaFilePath, deps) : undefined;
			return deps.adaptMyanimelistExports({ animeXml, mangaXml });
		},
	});
};
