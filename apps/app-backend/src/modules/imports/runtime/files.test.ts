import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import yazl from "yazl";

import {
	cleanupImportFile,
	extractImportZipArchive,
	readImportFile,
	readImportFileBytes,
	resolveSafeZipOutputPath,
	resolveSafeImportFilePath,
	validateFileExtension,
} from "./files";

const TEST_TEMP_DIR = "/tmp/ryot-test-imports";

const writeZipFile = async (
	filePath: string,
	entries: Array<{ fileName: string; text?: string; directory?: true }>,
) => {
	const zipFile = new yazl.ZipFile();
	for (const entry of entries) {
		if (entry.directory) {
			zipFile.addEmptyDirectory(entry.fileName);
			continue;
		}
		zipFile.addBuffer(Buffer.from(entry.text ?? "", "utf8"), entry.fileName);
	}

	const zipBuffer = await new Promise<Buffer>((resolve, reject) => {
		const chunks: Buffer[] = [];
		zipFile.outputStream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
		zipFile.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
		zipFile.outputStream.on("error", reject);
		zipFile.end();
	});

	await Bun.write(filePath, zipBuffer);
};

describe("resolveSafeImportFilePath", () => {
	it("accepts a file inside the temp dir", () => {
		const result = resolveSafeImportFilePath(`${TEST_TEMP_DIR}/export.csv`, TEST_TEMP_DIR);
		expect("path" in result).toBe(true);
		if ("path" in result) {
			expect(result.path).toBe(`${TEST_TEMP_DIR}/export.csv`);
		}
	});

	it("rejects a path that escapes the temp dir via traversal", () => {
		const result = resolveSafeImportFilePath(`${TEST_TEMP_DIR}/../../../etc/passwd`, TEST_TEMP_DIR);
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toContain("temporary upload directory");
		}
	});

	it("rejects an absolute path outside the temp dir", () => {
		const result = resolveSafeImportFilePath("/etc/passwd", TEST_TEMP_DIR);
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toContain("temporary upload directory");
		}
	});

	it("rejects the temp dir itself as a file path", () => {
		const result = resolveSafeImportFilePath(TEST_TEMP_DIR, TEST_TEMP_DIR);
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toContain("temporary upload directory");
		}
	});
});

describe("validateFileExtension", () => {
	it("accepts a .csv file when csv is allowed", () => {
		const result = validateFileExtension("/tmp/export.csv", ["csv"]);
		expect("ok" in result).toBe(true);
	});

	it("rejects a .json file when only csv is allowed", () => {
		const result = validateFileExtension("/tmp/export.json", ["csv"]);
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toContain("csv");
		}
	});

	it("accepts any of the allowed extensions", () => {
		const result = validateFileExtension("/tmp/export.json", ["csv", "json"]);
		expect("ok" in result).toBe(true);
	});

	it("is case-insensitive for extensions", () => {
		const result = validateFileExtension("/tmp/export.CSV", ["csv"]);
		expect("ok" in result).toBe(true);
	});
});

describe("readImportFile", () => {
	const testFilePath = `${TEST_TEMP_DIR}/read-test.csv`;

	beforeEach(async () => {
		await Bun.write(testFilePath, "col1,col2\nval1,val2\n");
	});

	afterEach(async () => {
		await Bun.file(testFilePath)
			.delete()
			.catch(() => undefined);
	});

	it("reads file content", async () => {
		const content = await readImportFile(testFilePath);
		expect(content).toContain("col1,col2");
	});

	it("rejects files exceeding the size limit", async () => {
		const maxBytes = 10;
		try {
			await readImportFile(testFilePath, maxBytes);
			expect(true).toBe(false);
		} catch (error) {
			expect(error instanceof Error).toBe(true);
			if (error instanceof Error) {
				expect(error.message).toContain("exceeds maximum");
			}
		}
	});
});

describe("readImportFileBytes", () => {
	const testFilePath = `${TEST_TEMP_DIR}/read-bytes-test.bin`;

	beforeEach(async () => {
		await Bun.write(testFilePath, new Uint8Array([1, 2, 3, 4]));
	});

	afterEach(async () => {
		await Bun.file(testFilePath)
			.delete()
			.catch(() => undefined);
	});

	it("reads file bytes", async () => {
		const bytes = await readImportFileBytes(testFilePath);
		expect([...bytes]).toEqual([1, 2, 3, 4]);
	});

	it("rejects byte reads exceeding the size limit", async () => {
		try {
			await readImportFileBytes(testFilePath, 2);
			expect(true).toBe(false);
		} catch (error) {
			expect(error instanceof Error).toBe(true);
			if (error instanceof Error) {
				expect(error.message).toContain("exceeds maximum");
			}
		}
	});
});

describe("extractImportZipArchive", () => {
	it("extracts safe zip entries into a temporary directory", async () => {
		const zipPath = `${TEST_TEMP_DIR}/netflix-export.zip`;
		await writeZipFile(zipPath, [
			{ fileName: "Netflix/ViewingActivity.csv", text: "Title\nMovie" },
			{ fileName: "Netflix/Ratings.csv", text: "Title Name\nMovie" },
			{ fileName: "Netflix/MyList.csv", text: "Title Name\nShow" },
		]);

		const result = await extractImportZipArchive(zipPath);
		expect(result.entries.map((entry) => entry.fileName)).toEqual([
			"Netflix/ViewingActivity.csv",
			"Netflix/Ratings.csv",
			"Netflix/MyList.csv",
		]);
		expect(await Bun.file(result.entries[0]?.filePath ?? "").text()).toBe("Title\nMovie");

		await cleanupImportFile(result.directoryPath);
	});

	it("rejects path traversal entries", () => {
		expect(() => resolveSafeZipOutputPath(`${TEST_TEMP_DIR}/extract-root`, "../evil.csv")).toThrow(
			/invalid|escapes/i,
		);
	});

	it("rejects zip archives with too many files", async () => {
		const zipPath = `${TEST_TEMP_DIR}/too-many.zip`;
		await writeZipFile(
			zipPath,
			Array.from({ length: 3 }, (_, index) => ({
				text: String(index),
				fileName: `entry-${index}.csv`,
			})),
		);

		try {
			await extractImportZipArchive(zipPath, { maxEntryCount: 2 });
			expect.unreachable();
		} catch (error) {
			expect(error instanceof Error).toBe(true);
			if (error instanceof Error) {
				expect(error.message).toMatch(/too many entries/i);
			}
		}
	});

	it("counts directory entries toward the archive entry limit", async () => {
		const zipPath = `${TEST_TEMP_DIR}/too-many-directories.zip`;
		await writeZipFile(zipPath, [
			{ directory: true, fileName: "Netflix/" },
			{ fileName: "Netflix/ViewingActivity.csv", text: "Title\nMovie" },
		]);

		try {
			await extractImportZipArchive(zipPath, { maxEntryCount: 1 });
			expect.unreachable();
		} catch (error) {
			expect(error instanceof Error).toBe(true);
			if (error instanceof Error) {
				expect(error.message).toMatch(/too many entries/i);
			}
		}
	});

	it("rejects zip archives that exceed the decompressed size limit", async () => {
		const zipPath = `${TEST_TEMP_DIR}/too-large.zip`;
		await writeZipFile(zipPath, [
			{ fileName: "large.csv", text: "a".repeat(32) },
			{ fileName: "other.csv", text: "b".repeat(32) },
		]);

		try {
			await extractImportZipArchive(zipPath, { maxTotalBytes: 40 });
			expect.unreachable();
		} catch (error) {
			expect(error instanceof Error).toBe(true);
			if (error instanceof Error) {
				expect(error.message).toMatch(/uncompressed size/i);
			}
		}
	});
});

describe("cleanupImportFile", () => {
	const testFilePath = `${TEST_TEMP_DIR}/cleanup-test.csv`;

	beforeEach(async () => {
		await Bun.write(testFilePath, "cleanup me");
	});

	it("deletes the file without throwing", async () => {
		await cleanupImportFile(testFilePath);
		const exists = await Bun.file(testFilePath).exists();
		expect(exists).toBe(false);
	});

	it("does not throw when file does not exist", async () => {
		await cleanupImportFile("/tmp/nonexistent-abc123.csv");
	});

	it("deletes directories recursively without throwing", async () => {
		const directoryPath = `${TEST_TEMP_DIR}/cleanup-dir`;
		await Bun.write(`${directoryPath}/nested/file.csv`, "cleanup me");
		await cleanupImportFile(directoryPath);
		expect(await Bun.file(`${directoryPath}/nested/file.csv`).exists()).toBe(false);
	});
});
