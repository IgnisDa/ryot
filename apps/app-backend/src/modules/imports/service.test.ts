import { describe, expect, it } from "bun:test";

import { resolveSafeImportFilePath, validateFileExtension } from "./file-helpers";
import { importRunFailureStage, importRunSource, importRunStatus } from "./schemas";
import { isTerminalStatus } from "./service";

const mockTempDir = "/tmp/test-uploads";
const validCsvPath = `${mockTempDir}/openscale-export.csv`;

describe("isTerminalStatus", () => {
	it("returns true for completed and failed", () => {
		expect(isTerminalStatus("completed")).toBe(true);
		expect(isTerminalStatus("failed")).toBe(true);
	});

	it("returns false for pending and running", () => {
		expect(isTerminalStatus("pending")).toBe(false);
		expect(isTerminalStatus("running")).toBe(false);
	});
});

describe("startImportRun file path validation", () => {
	it("rejects a path outside the temp dir", () => {
		const result = resolveSafeImportFilePath("/etc/passwd", mockTempDir);

		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toContain("temporary upload directory");
		}
	});

	it("rejects path traversal to escape the temp dir", () => {
		const result = resolveSafeImportFilePath(`${mockTempDir}/../../../etc/passwd`, mockTempDir);

		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toContain("temporary upload directory");
		}
	});

	it("accepts a file inside the temp dir", () => {
		const result = resolveSafeImportFilePath(validCsvPath, mockTempDir);

		expect("path" in result).toBe(true);
	});
});

describe("startImportRun extension validation", () => {
	it("rejects a non-CSV extension", () => {
		const result = validateFileExtension(`${mockTempDir}/export.json`, ["csv"]);

		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toContain("csv");
		}
	});

	it("accepts a .csv file", () => {
		const result = validateFileExtension(validCsvPath, ["csv"]);

		expect("ok" in result).toBe(true);
	});
});

describe("import run schema enums", () => {
	it("importRunStatus covers all lifecycle states", () => {
		expect(importRunStatus.options).toEqual(["pending", "running", "completed", "failed"]);
	});

	it("importRunFailureStage covers all failure stages", () => {
		expect(importRunFailureStage.options).toContain("source_fetch");
		expect(importRunFailureStage.options).toContain("input_transformation");
		expect(importRunFailureStage.options).toContain("provider_details");
		expect(importRunFailureStage.options).toContain("database_commit");
	});

	it("importRunSource includes implemented CSV sources", () => {
		expect(importRunSource.options).toContain("hevy");
		expect(importRunSource.options).toContain("open_scale");
		expect(importRunSource.options).toContain("strong_app");
	});
});
