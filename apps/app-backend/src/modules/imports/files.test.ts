import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import node_path from "node:path";

import {
	cleanupImportFile,
	readImportFile,
	resolveSafeImportFilePath,
	validateFileExtension,
} from "./files";

const TEST_TEMP_DIR = "/tmp/ryot-test-imports";

describe("resolveSafeImportFilePath", () => {
	it("accepts a file inside the temp dir", () => {
		const result = resolveSafeImportFilePath(`${TEST_TEMP_DIR}/export.csv`, TEST_TEMP_DIR);
		expect("path" in result).toBe(true);
		if ("path" in result) {
			expect(result.path).toBe(node_path.resolve(`${TEST_TEMP_DIR}/export.csv`));
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
});
