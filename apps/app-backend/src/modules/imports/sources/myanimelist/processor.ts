import { Effect } from "effect";

import { AppConfig } from "#lib/config";
import type { ImportRunId, UserId } from "#lib/schema/brands";

import type {
	LoadedMediaImportAdapterError,
	LoadedMediaImportAdapterResult,
} from "../../media/file-processor";
import { getValidatedOptionalPath, readImportFileBytes } from "../../runtime/import-files";
import { sanitizeErrorMessage } from "../../runtime/import-run-status";
import { adaptMyanimelistExports } from "./adapter";

const MYANIMELIST_EXTENSIONS = ["gz", "xml"];
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const createDecompressedFileTooLargeMessage = () =>
	`Import file exceeds maximum allowed size of ${MAX_FILE_BYTES} bytes after decompression`;

const decodeMyanimelistFile = Effect.fn(function* (filePath: string) {
	const bytes = yield* readImportFileBytes(filePath, MAX_FILE_BYTES);
	if (!filePath.toLowerCase().endsWith(".gz")) {
		return new TextDecoder().decode(bytes);
	}
	return yield* Effect.try({
		try: () => {
			const decompressed = Bun.gunzipSync(new Uint8Array(bytes));
			if (decompressed.byteLength > MAX_FILE_BYTES) {
				throw new Error(createDecompressedFileTooLargeMessage());
			}
			return new TextDecoder().decode(decompressed);
		},
		catch: (error) => sanitizeErrorMessage(error, "Could not read import file"),
	});
});

export const loadMyanimelistAdapterResult = Effect.fn("myanimelistProcessor.load")(
	function* (input: {
		runId: ImportRunId;
		userId: UserId;
		filePath?: string;
		sourcePayload?: Record<string, unknown>;
	}) {
		const config = yield* AppConfig;
		const { animeFilePath, mangaFilePath } = yield* Effect.all({
			animeFilePath: getValidatedOptionalPath(
				input.sourcePayload?.animeFilePath,
				MYANIMELIST_EXTENSIONS,
				config.tmpDir,
			),
			mangaFilePath: getValidatedOptionalPath(
				input.sourcePayload?.mangaFilePath,
				MYANIMELIST_EXTENSIONS,
				config.tmpDir,
			),
		}).pipe(
			Effect.mapError(
				(message) => ({ cleanupPaths: [], message }) satisfies LoadedMediaImportAdapterError,
			),
		);
		const primaryFilePath = animeFilePath ?? mangaFilePath ?? input.filePath;
		const resolvedAnimeFilePath = animeFilePath ?? (mangaFilePath ? undefined : primaryFilePath);
		const cleanupPaths = [primaryFilePath, resolvedAnimeFilePath, mangaFilePath].filter(
			(filePath): filePath is string => Boolean(filePath),
		);

		const animeXml = resolvedAnimeFilePath
			? yield* decodeMyanimelistFile(resolvedAnimeFilePath).pipe(
					Effect.mapError(
						(message) => ({ message, cleanupPaths }) satisfies LoadedMediaImportAdapterError,
					),
				)
			: undefined;
		const mangaXml = mangaFilePath
			? yield* decodeMyanimelistFile(mangaFilePath).pipe(
					Effect.mapError(
						(message) => ({ message, cleanupPaths }) satisfies LoadedMediaImportAdapterError,
					),
				)
			: undefined;
		const adapterResult = yield* Effect.try({
			try: () => adaptMyanimelistExports({ animeXml, mangaXml }),
			catch: (error) =>
				({
					message: sanitizeErrorMessage(error, "Could not parse MyAnimeList export data"),
					cleanupPaths,
				}) satisfies LoadedMediaImportAdapterError,
		});

		return { adapterResult, cleanupPaths } satisfies LoadedMediaImportAdapterResult;
	},
);
