import { describe, expect, it } from "vitest";

import { SANDBOX_LIMITS, utf8ByteLength } from "./limits";
import { formatSandboxStderr, makeSandboxStderrTail } from "./runtime";
import type { SandboxStderrSnapshot } from "./runtime";

describe("sandbox stderr diagnostics", () => {
	it("retains newest lines and marks evicted output", () => {
		const tail = makeSandboxStderrTail();
		for (let index = 0; index < SANDBOX_LIMITS.diagnostics.stderrLines + 3; index += 1) {
			tail.append(`stderr-${index}`);
		}

		const snapshot = tail.snapshot();
		expect(snapshot.lines).toEqual(
			Array.from(
				{ length: SANDBOX_LIMITS.diagnostics.stderrLines },
				(_, index) => `stderr-${index + 3}`,
			),
		);
		expect(snapshot.truncated).toBe(true);
		expect(formatSandboxStderr(snapshot)).toContain("[sandbox stderr truncated]");
		expect(formatSandboxStderr(snapshot)).not.toContain("stderr-0");
	});

	it("caps oversized UTF-8 lines", () => {
		const tail = makeSandboxStderrTail();
		tail.append("🙂".repeat(SANDBOX_LIMITS.diagnostics.stderrBytes));

		const snapshot = tail.snapshot();
		const line = snapshot.lines[0] ?? "";
		expect(snapshot.lines).toHaveLength(1);
		expect(utf8ByteLength(line)).toBeLessThanOrEqual(SANDBOX_LIMITS.diagnostics.stderrBytes);
		expect(line).toContain("[sandbox stderr line truncated]");
	});

	it("formats empty diagnostics without changing base errors", () => {
		const snapshot: SandboxStderrSnapshot = { lines: [], truncated: false };
		expect(formatSandboxStderr(snapshot)).toBe("");
	});
});
