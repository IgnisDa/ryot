import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import node_path from "node:path";
import { pipeline } from "node:stream/promises";

import * as yauzl from "yauzl";

import { getTemporaryDirectory } from "~/lib/bun";

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

const openZipFile = async (safePath: string): Promise<yauzl.ZipFile> =>
	new Promise((resolve, reject) => {
		yauzl.open(safePath, { lazyEntries: true, validateEntrySizes: true }, (error, zipFile) => {
			if (error) {
				reject(error);
				return;
			}
			resolve(zipFile);
		});
	});

const readNextZipEntry = async (zipFile: yauzl.ZipFile): Promise<yauzl.Entry | null> =>
	new Promise((resolve, reject) => {
		const onEntry = (entry: yauzl.Entry) => {
			cleanup();
			resolve(entry);
		};
		const onEnd = () => {
			cleanup();
			resolve(null);
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
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

const openZipEntryReadStream = async (
	zipFile: yauzl.ZipFile,
	entry: yauzl.Entry,
): Promise<NodeJS.ReadableStream> =>
	new Promise((resolve, reject) => {
		zipFile.openReadStream(entry, (error, stream) => {
			if (error) {
				reject(error);
				return;
			}
			resolve(stream);
		});
	});

export const resolveSafeZipOutputPath = (directoryPath: string, fileName: string): string => {
	const validationError = yauzl.validateFileName(fileName);
	if (validationError) {
		throw new Error(`ZIP entry "${fileName}" is invalid: ${validationError}`);
	}

	const resolvedDirectoryPath = node_path.resolve(directoryPath);
	const outputPath = node_path.resolve(resolvedDirectoryPath, fileName);
	if (!outputPath.startsWith(resolvedDirectoryPath + node_path.sep)) {
		throw new Error(`ZIP entry "${fileName}" escapes the extraction directory`);
	}

	return outputPath;
};

export const resolveSafeImportFilePath = (
	filePath: string,
	tempDir: string,
): { path: string } | { error: string } => {
	const normalizedTempDir = node_path.resolve(tempDir);
	const resolvedPath = node_path.resolve(filePath);

	if (!resolvedPath.startsWith(normalizedTempDir + node_path.sep)) {
		return { error: "Import file path must be inside the configured temporary upload directory" };
	}

	return { path: resolvedPath };
};

export const validateFileExtension = (
	filePath: string,
	allowedExtensions: string[],
): { ok: true } | { error: string } => {
	const ext = node_path.extname(filePath).toLowerCase().replace(/^\./, "");
	if (!allowedExtensions.includes(ext)) {
		return {
			error: `Import file must have one of the following extensions: ${allowedExtensions.join(", ")}`,
		};
	}
	return { ok: true };
};

export const readImportFile = async (
	safePath: string,
	maxBytes = MAX_FILE_BYTES,
): Promise<string> => {
	const file = Bun.file(safePath);
	const size = file.size;
	if (size > maxBytes) {
		throw new Error(
			`Import file exceeds maximum allowed size of ${maxBytes} bytes (file is ${size} bytes)`,
		);
	}
	return file.text();
};

export const readImportFileBytes = async (
	safePath: string,
	maxBytes = MAX_FILE_BYTES,
): Promise<Uint8Array> => {
	const file = Bun.file(safePath);
	const size = file.size;
	if (size > maxBytes) {
		throw new Error(
			`Import file exceeds maximum allowed size of ${maxBytes} bytes (file is ${size} bytes)`,
		);
	}
	return new Uint8Array(await file.arrayBuffer());
};

export const extractImportZipArchive = async (
	safePath: string,
	options: ExtractImportZipArchiveOptions = {},
): Promise<ExtractImportZipArchiveResult> => {
	const importFile = Bun.file(safePath);
	if (importFile.size > MAX_FILE_BYTES) {
		throw new Error(
			`Import file exceeds maximum allowed size of ${MAX_FILE_BYTES} bytes (file is ${importFile.size} bytes)`,
		);
	}

	const maxEntryBytes = options.maxEntryBytes ?? MAX_ZIP_ENTRY_BYTES;
	const maxEntryCount = options.maxEntryCount ?? MAX_ZIP_ENTRY_COUNT;
	const maxTotalBytes = options.maxTotalBytes ?? MAX_ZIP_TOTAL_BYTES;
	const directoryPath = await mkdtemp(
		node_path.join(getTemporaryDirectory(), ZIP_TEMP_DIRECTORY_PREFIX),
	);
	const entries: ImportZipEntry[] = [];
	let totalUncompressedSize = 0;
	let extractedEntryCount = 0;
	let openedZipFile: yauzl.ZipFile | undefined;

	try {
		openedZipFile = await openZipFile(safePath);
		const zipFile = openedZipFile;

		// ZIP extraction is intentionally sequential so limits are enforced entry-by-entry.
		// oxlint-disable no-await-in-loop
		for (;;) {
			const entry = await readNextZipEntry(zipFile);
			if (entry === null) {
				break;
			}

			const outputPath = resolveSafeZipOutputPath(directoryPath, entry.fileName);
			extractedEntryCount += 1;
			if (extractedEntryCount > maxEntryCount) {
				throw new Error(`ZIP archive contains too many entries (maximum ${maxEntryCount})`);
			}

			if (entry.fileName.endsWith("/")) {
				// oxlint-disable-next-line no-await-in-loop
				await mkdir(outputPath, { recursive: true });
				continue;
			}

			if (entry.uncompressedSize > maxEntryBytes) {
				throw new Error(
					`ZIP entry "${entry.fileName}" exceeds maximum allowed size of ${maxEntryBytes} bytes`,
				);
			}

			totalUncompressedSize += entry.uncompressedSize;
			if (totalUncompressedSize > maxTotalBytes) {
				throw new Error(
					`ZIP archive exceeds maximum allowed uncompressed size of ${maxTotalBytes} bytes`,
				);
			}

			// oxlint-disable-next-line no-await-in-loop
			await mkdir(node_path.dirname(outputPath), { recursive: true });
			// oxlint-disable-next-line no-await-in-loop
			const readStream = await openZipEntryReadStream(zipFile, entry);
			// oxlint-disable-next-line no-await-in-loop
			await pipeline(readStream, createWriteStream(outputPath));
			entries.push({
				filePath: outputPath,
				fileName: entry.fileName,
				uncompressedSize: entry.uncompressedSize,
			});
		}
		// oxlint-enable no-await-in-loop

		return { directoryPath, entries };
	} catch (error) {
		await cleanupImportFile(directoryPath);
		throw error;
	} finally {
		openedZipFile?.close();
	}
};

export const cleanupImportFile = async (safePath: string): Promise<void> => {
	if (!safePath.trim()) {
		return;
	}

	try {
		await rm(safePath, { force: true, recursive: true });
	} catch (error) {
		console.warn("Import file cleanup failed", error);
	}
};
