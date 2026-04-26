import { FileSystem, Path } from "@effect/platform";
import { Data, Effect, Either } from "effect";
import * as yauzl from "yauzl";

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

const openZipFile = (safePath: string) =>
	Effect.async<yauzl.ZipFile, ImportZipArchiveError>((resume) => {
		yauzl.open(safePath, { lazyEntries: true, validateEntrySizes: true }, (error, zipFile) => {
			if (error) {
				resume(Effect.fail(unknownToZipArchiveError(error, "Could not open ZIP archive")));
				return;
			}
			resume(Effect.succeed(zipFile));
		});
	});

const readNextZipEntry = (zipFile: yauzl.ZipFile) =>
	Effect.async<yauzl.Entry | null, ImportZipArchiveError>((resume) => {
		const onEntry = (entry: yauzl.Entry) => {
			cleanup();
			resume(Effect.succeed(entry));
		};
		const onEnd = () => {
			cleanup();
			resume(Effect.succeed(null));
		};
		const onError = (error: Error) => {
			cleanup();
			resume(Effect.fail(unknownToZipArchiveError(error, "Could not read ZIP entry")));
		};
		const cleanup = () => {
			zipFile.off("entry", onEntry);
			zipFile.off("end", onEnd);
			zipFile.off("error", onError);
		};

		zipFile.once("entry", onEntry);
		zipFile.once("end", onEnd);
		zipFile.once("error", onError);
		zipFile.readEntry();
	});

const openZipEntryReadStream = (
	zipFile: yauzl.ZipFile,
	entry: yauzl.Entry,
): Effect.Effect<NodeJS.ReadableStream, ImportZipArchiveError> =>
	Effect.async<NodeJS.ReadableStream, ImportZipArchiveError>((resume) => {
		zipFile.openReadStream(entry, (error, stream) => {
			if (error) {
				resume(Effect.fail(unknownToZipArchiveError(error, "Could not open ZIP entry")));
				return;
			}
			resume(Effect.succeed(stream));
		});
	});

const chunkToBytes = (chunk: unknown): Uint8Array => {
	if (chunk instanceof Uint8Array) {
		return chunk;
	}
	if (chunk instanceof ArrayBuffer) {
		return new Uint8Array(chunk);
	}
	if (ArrayBuffer.isView(chunk)) {
		return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
	}
	if (typeof chunk === "string") {
		return new TextEncoder().encode(chunk);
	}
	throw zipArchiveError("ZIP entry stream emitted unsupported data");
};

const readZipEntryBytes = (
	stream: NodeJS.ReadableStream,
	maxEntryBytes: number,
	fileName: string,
) =>
	Effect.async<Uint8Array, ImportZipArchiveError>((resume) => {
		let totalBytes = 0;
		const chunks: Uint8Array[] = [];

		const cleanup = () => {
			stream.off("data", onData);
			stream.off("end", onEnd);
			stream.off("error", onError);
		};
		const cancelStream = () => {
			if (!("destroy" in stream)) {
				return;
			}
			const destroy = stream.destroy;
			if (typeof destroy === "function") {
				destroy.call(stream);
			}
		};
		const onData = (chunk: unknown) => {
			const parsedBytes = Either.try(() => chunkToBytes(chunk));
			if (Either.isLeft(parsedBytes)) {
				cleanup();
				cancelStream();
				resume(
					Effect.fail(
						unknownToZipArchiveError(parsedBytes.left, "Could not read ZIP entry stream"),
					),
				);
				return;
			}
			const bytes = parsedBytes.right;
			totalBytes += bytes.byteLength;
			if (totalBytes > maxEntryBytes) {
				cleanup();
				cancelStream();
				resume(
					Effect.fail(
						zipArchiveError(
							`ZIP entry "${fileName}" exceeds maximum allowed size of ${maxEntryBytes} bytes`,
						),
					),
				);
				return;
			}
			chunks.push(bytes);
		};
		const onEnd = () => {
			cleanup();
			let offset = 0;
			const bytes = new Uint8Array(totalBytes);
			for (const chunk of chunks) {
				bytes.set(chunk, offset);
				offset += chunk.byteLength;
			}
			resume(Effect.succeed(bytes));
		};
		const onError = (error: Error) => {
			cleanup();
			resume(Effect.fail(unknownToZipArchiveError(error, "Could not read ZIP entry stream")));
		};

		stream.on("data", onData);
		stream.once("end", onEnd);
		stream.once("error", onError);
	});

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

export const readImportFile = (safePath: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		return yield* fs.readFileString(safePath);
	});

export const readImportFileBytes = (safePath: string, maxBytes = MAX_FILE_BYTES) =>
	Effect.gen(function* () {
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
	const validationError = yauzl.validateFileName(fileName);
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

export const extractImportZipArchive = (
	safePath: string,
	options: ExtractImportZipArchiveOptions = {},
) =>
	Effect.gen(function* () {
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

		const extractEntries = (zipFile: yauzl.ZipFile) =>
			Effect.gen(function* () {
				const entries: ImportZipEntry[] = [];
				let totalUncompressedSize = 0;
				let extractedEntryCount = 0;

				for (;;) {
					const entry = yield* readNextZipEntry(zipFile);
					if (entry === null) {
						break;
					}

					const outputPath = yield* Effect.try({
						try: () => resolveSafeZipOutputPath(path, directoryPath, entry.fileName),
						catch: (error) => unknownToZipArchiveError(error, "Could not resolve ZIP entry path"),
					});
					extractedEntryCount += 1;
					if (extractedEntryCount > maxEntryCount) {
						return yield* zipArchiveError(
							`ZIP archive contains too many entries (maximum ${maxEntryCount})`,
						);
					}

					if (entry.fileName.endsWith("/")) {
						yield* fs.makeDirectory(outputPath, { recursive: true });
						continue;
					}

					if (entry.uncompressedSize > maxEntryBytes) {
						return yield* zipArchiveError(
							`ZIP entry "${entry.fileName}" exceeds maximum allowed size of ${maxEntryBytes} bytes`,
						);
					}

					totalUncompressedSize += entry.uncompressedSize;
					if (totalUncompressedSize > maxTotalBytes) {
						return yield* zipArchiveError(
							`ZIP archive exceeds maximum allowed uncompressed size of ${maxTotalBytes} bytes`,
						);
					}

					yield* fs.makeDirectory(path.dirname(outputPath), { recursive: true });
					const readStream = yield* openZipEntryReadStream(zipFile, entry);
					const bytes = yield* readZipEntryBytes(readStream, maxEntryBytes, entry.fileName);
					yield* fs.writeFile(outputPath, bytes);
					entries.push({
						filePath: outputPath,
						fileName: entry.fileName,
						uncompressedSize: entry.uncompressedSize,
					});
				}

				return { directoryPath, entries };
			});

		return yield* Effect.acquireUseRelease(openZipFile(safePath), extractEntries, (zipFile) =>
			Effect.sync(() => zipFile.close()),
		).pipe(
			Effect.tapError(() => fs.remove(directoryPath, { recursive: true }).pipe(Effect.ignore)),
		);
	});

export const cleanupImportFile = (safePath: string) =>
	Effect.gen(function* () {
		if (!safePath.trim()) {
			return;
		}
		const fs = yield* FileSystem.FileSystem;
		yield* fs.remove(safePath, { recursive: true }).pipe(Effect.ignore);
	});
