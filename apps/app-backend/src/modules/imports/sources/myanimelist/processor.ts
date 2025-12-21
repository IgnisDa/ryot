import { Effect, Either } from "effect";

import { processMediaImport } from "../../media/import-processor";
import { failImportRun, sanitizeErrorMessage } from "../../runtime/failures";
import {
	cleanupImportFile,
	getValidatedOptionalPath,
	readImportFileBytes,
} from "../../runtime/files";
import { adaptMyanimelistExports } from "./adapter";

const MYANIMELIST_EXTENSIONS = ["gz", "xml"];
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const createDecompressedFileTooLargeMessage = () =>
	`Import file exceeds maximum allowed size of ${MAX_FILE_BYTES} bytes after decompression`;

const decodeMyanimelistFile = (filePath: string) =>
	Effect.gen(function* () {
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

export const processMyanimelistImport = (input: {
	runId: string;
	userId: string;
	filePath?: string;
	sourcePayload?: Record<string, unknown>;
}) =>
	Effect.gen(function* () {
		const paths = yield* Effect.try({
			try: () => {
				const animeFilePath = getValidatedOptionalPath(
					input.sourcePayload?.animeFilePath,
					MYANIMELIST_EXTENSIONS,
				);
				const mangaFilePath = getValidatedOptionalPath(
					input.sourcePayload?.mangaFilePath,
					MYANIMELIST_EXTENSIONS,
				);
				const primaryFilePath = animeFilePath ?? mangaFilePath ?? input.filePath;
				const resolvedAnimeFilePath =
					animeFilePath ?? (mangaFilePath ? undefined : primaryFilePath);
				return { mangaFilePath, primaryFilePath, resolvedAnimeFilePath };
			},
			catch: (error) => sanitizeErrorMessage(error, "Import job has invalid MyAnimeList files"),
		}).pipe(Effect.either);

		if (Either.isLeft(paths)) {
			yield* failImportRun(input.runId, paths.left);
			return;
		}

		const { mangaFilePath, primaryFilePath, resolvedAnimeFilePath } = paths.right;
		const cleanupPaths = [primaryFilePath, resolvedAnimeFilePath, mangaFilePath].filter(
			(filePath): filePath is string => Boolean(filePath),
		);

		yield* processMediaImport({
			runId: input.runId,
			userId: input.userId,
			sourceName: "MyAnimeList",
			adapterErrorFallback: "Could not parse MyAnimeList export data",
			loadAdapterResult: Effect.gen(function* () {
				const animeXml = resolvedAnimeFilePath
					? yield* decodeMyanimelistFile(resolvedAnimeFilePath)
					: undefined;
				const mangaXml = mangaFilePath ? yield* decodeMyanimelistFile(mangaFilePath) : undefined;
				return yield* Effect.try({
					try: () => adaptMyanimelistExports({ animeXml, mangaXml }),
					catch: (error) => sanitizeErrorMessage(error, "Could not parse MyAnimeList export data"),
				});
			}),
		}).pipe(
			Effect.ensuring(Effect.forEach(new Set(cleanupPaths), cleanupImportFile, { discard: true })),
		);
	});
