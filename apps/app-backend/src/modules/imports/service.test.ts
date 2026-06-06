import { describe, expect, it } from "bun:test";

import { importRunFailureStage, importRunSource, importRunStatus } from "./schemas";
import { isTerminalStatus } from "./service";

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

describe("import run schema enums", () => {
	it("importRunStatus covers all lifecycle states", () => {
		expect(importRunStatus.options).toEqual(["pending", "running", "completed", "failed"]);
	});

	it("importRunFailureStage covers all failure stages", () => {
		expect(importRunFailureStage.options).toContain("source_fetch");
		expect(importRunFailureStage.options).toContain("input_transformation");
		expect(importRunFailureStage.options).toContain("provider_details");
		expect(importRunFailureStage.options).toContain("provider_resolution");
		expect(importRunFailureStage.options).toContain("database_commit");
	});

	it("importRunSource includes implemented CSV sources", () => {
		expect(importRunSource.options).toContain("goodreads");
		expect(importRunSource.options).toContain("hardcover");
		expect(importRunSource.options).toContain("hevy");
		expect(importRunSource.options).toContain("open_scale");
		expect(importRunSource.options).toContain("strong_app");
		expect(importRunSource.options).toContain("storygraph");
	});
});
