import { Effect, Either } from "effect";

import type {
	LoadedMediaImportAdapterError,
	LoadedMediaImportAdapterResult,
} from "../../media/file-processor";
import { sanitizeErrorMessage } from "../../runtime/failures";
import { getValidatedOptionalPath, readImportFileBytes } from "../../runtime/files";
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
		runId: string;
		userId: string;
		filePath?: string;
		sourcePayload?: Record<string, unknown>;
	}) {
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
			return yield* Effect.fail({
				cleanupPaths: [],
				message: paths.left,
			} satisfies LoadedMediaImportAdapterError);
		}

		const { mangaFilePath, primaryFilePath, resolvedAnimeFilePath } = paths.right;
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
