import { describe, expect, it } from "bun:test";

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
