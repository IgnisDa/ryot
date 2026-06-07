import { FileSystem, Path } from "@effect/platform";
import { Data, Effect } from "effect";
import { unzipRaw } from "unzipit";

const MAX_ZIP_ENTRY_COUNT = 100;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_ZIP_ENTRY_BYTES = 25 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 100 * 1024 * 1024;
const ZIP_TEMP_DIRECTORY_PREFIX = "ryot-import-zip-";

type ImportZipEntry = {
	fileName: string;
	filePath: string;
	uncompressedSize: number;
};

export type ExtractImportZipArchiveResult = {
	directoryPath: string;
	entries: ImportZipEntry[];
};

type ExtractImportZipArchiveOptions = {
	maxEntryBytes?: number;
	maxEntryCount?: number;
	maxTotalBytes?: number;
};

class ImportZipArchiveError extends Data.TaggedError("ImportZipArchiveError")<{
	message: string;
	cause?: unknown;
}> {}

const zipArchiveError = (message: string) => new ImportZipArchiveError({ message });

const unknownToZipArchiveError = (cause: unknown, fallback: string) =>
	cause instanceof ImportZipArchiveError
		? cause
		: new ImportZipArchiveError({
				cause,
				message: cause instanceof Error ? cause.message : fallback,
			});

const validateZipFileName = (fileName: string): string | undefined => {
	if (fileName.includes("\0")) {
		return "null byte in file name";
	}
	if (fileName.startsWith("/")) {
		return "absolute path: " + fileName;
	}
	if (fileName.includes("\\")) {
		return "invalid characters in fileName: " + fileName;
	}
	if (fileName.includes("..")) {
		return "invalid relative path: " + fileName;
	}
	return undefined;
};

export const getTemporaryDirectory = (): string => {
	const candidates = [Bun.env.TMPDIR, Bun.env.TMP, Bun.env.TEMP];
	const dir = candidates.find((v) => v && v.length > 0);
	return dir ?? "/tmp";
};

export const resolveSafeImportFilePath = (
	filePath: string,
	tempDir: string,
): { path: string } | { error: string } => {
	const normalizedTempDir = tempDir.replace(/[\\/]+$/, "");
	if (filePath.includes("..") || !filePath.startsWith(`${normalizedTempDir}/`)) {
		return { error: "Import file path must be inside the configured temporary upload directory" };
	}
	return { path: filePath };
};

export const validateFileExtension = (
	filePath: string,
	allowedExtensions: string[],
): { ok: true } | { error: string } => {
	const segment = filePath.split(/[\\/]/).pop() ?? "";
	const dotIndex = segment.lastIndexOf(".");
	const ext = dotIndex > 0 ? segment.slice(dotIndex + 1).toLowerCase() : "";
	if (!allowedExtensions.includes(ext)) {
		return {
			error: `Import file must have one of the following extensions: ${allowedExtensions.join(", ")}`,
		};
	}
	return { ok: true };
};

export const getValidatedOptionalPath = (
	value: unknown,
	allowedExtensions: string[],
): string | undefined => {
	if (typeof value !== "string" || value.trim().length === 0) {
		return undefined;
	}
	const safePathResult = resolveSafeImportFilePath(value, getTemporaryDirectory());
	if ("error" in safePathResult) {
		throw new Error(safePathResult.error);
	}
	const extResult = validateFileExtension(safePathResult.path, allowedExtensions);
	if ("error" in extResult) {
		throw new Error(extResult.error);
	}
	return safePathResult.path;
};

export const readImportFile = Effect.fn("imports.readImportFile")(function* (safePath: string) {
	const fs = yield* FileSystem.FileSystem;
	return yield* fs.readFileString(safePath);
});

export const readImportFileBytes = Effect.fn("imports.readImportFileBytes")(function* (
	safePath: string,
	maxBytes = MAX_FILE_BYTES,
) {
	const fs = yield* FileSystem.FileSystem;
	const info = yield* fs.stat(safePath).pipe(Effect.mapError(() => "Could not read import file"));
	if (Number(info.size) > maxBytes) {
		return yield* Effect.fail(`Import file exceeds maximum allowed size of ${maxBytes} bytes`);
	}
	return yield* fs.readFile(safePath).pipe(Effect.mapError(() => "Could not read import file"));
});

export const resolveSafeZipOutputPath = (
	path: Path.Path,
	directoryPath: string,
	fileName: string,
): string => {
	const validationError = validateZipFileName(fileName);
	if (validationError) {
		throw new Error(`ZIP entry "${fileName}" is invalid: ${validationError}`);
	}

	const resolvedDirectoryPath = path.resolve(directoryPath);
	const outputPath = path.resolve(resolvedDirectoryPath, fileName);
	if (!outputPath.startsWith(resolvedDirectoryPath + path.sep)) {
		throw new Error(`ZIP entry "${fileName}" escapes the extraction directory`);
	}

	return outputPath;
};

export const extractImportZipArchive = Effect.fn("imports.extractImportZipArchive")(function* (
	safePath: string,
	options: ExtractImportZipArchiveOptions = {},
) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const importFile = Bun.file(safePath);
	if (importFile.size > MAX_FILE_BYTES) {
		return yield* zipArchiveError(
			`Import file exceeds maximum allowed size of ${MAX_FILE_BYTES} bytes (file is ${importFile.size} bytes)`,
		);
	}

	const maxEntryBytes = options.maxEntryBytes ?? MAX_ZIP_ENTRY_BYTES;
	const maxEntryCount = options.maxEntryCount ?? MAX_ZIP_ENTRY_COUNT;
	const maxTotalBytes = options.maxTotalBytes ?? MAX_ZIP_TOTAL_BYTES;
	const directoryPath = yield* fs.makeTempDirectory({
		prefix: ZIP_TEMP_DIRECTORY_PREFIX,
		directory: getTemporaryDirectory(),
	});

	const extractEntries = Effect.gen(function* () {
		const entries: ImportZipEntry[] = [];
		let totalUncompressedSize = 0;
		let extractedEntryCount = 0;

		const zipInfo = yield* Effect.tryPromise({
			try: () => unzipRaw(Bun.file(safePath)),
			catch: (error) => unknownToZipArchiveError(error, "Could not open ZIP archive"),
		});

		for (const entry of zipInfo.entries) {
			const outputPath = yield* Effect.try({
				try: () => resolveSafeZipOutputPath(path, directoryPath, entry.name),
				catch: (error) => unknownToZipArchiveError(error, "Could not resolve ZIP entry path"),
			});
			extractedEntryCount += 1;
			if (extractedEntryCount > maxEntryCount) {
				return yield* zipArchiveError(
					`ZIP archive contains too many entries (maximum ${maxEntryCount})`,
				);
			}

			if (entry.isDirectory) {
				yield* fs.makeDirectory(outputPath, { recursive: true });
				continue;
			}

			if (entry.size > maxEntryBytes) {
				return yield* zipArchiveError(
					`ZIP entry "${entry.name}" exceeds maximum allowed size of ${maxEntryBytes} bytes`,
				);
			}

			totalUncompressedSize += entry.size;
			if (totalUncompressedSize > maxTotalBytes) {
				return yield* zipArchiveError(
					`ZIP archive exceeds maximum allowed uncompressed size of ${maxTotalBytes} bytes`,
				);
			}

			yield* fs.makeDirectory(path.dirname(outputPath), { recursive: true });
			const buffer = yield* Effect.tryPromise({
				try: () => entry.arrayBuffer(),
				catch: (error) => unknownToZipArchiveError(error, "Could not read ZIP entry"),
			});
			yield* fs.writeFile(outputPath, new Uint8Array(buffer));
			entries.push({ filePath: outputPath, fileName: entry.name, uncompressedSize: entry.size });
		}

		return { directoryPath, entries };
	}).pipe(Effect.tapError(() => fs.remove(directoryPath, { recursive: true }).pipe(Effect.ignore)));

	return yield* extractEntries;
});

export const resolveImportPath = (filePath: string): string[] => {
	const safePathResult = resolveSafeImportFilePath(filePath, getTemporaryDirectory());
	return "path" in safePathResult ? [safePathResult.path] : [];
};

export const cleanupImportFile = Effect.fn("imports.cleanupImportFile")(function* (
	safePath: string,
) {
	if (!safePath.trim()) {
		return;
	}
	const fs = yield* FileSystem.FileSystem;
	yield* fs.remove(safePath, { recursive: true }).pipe(Effect.ignore);
});
