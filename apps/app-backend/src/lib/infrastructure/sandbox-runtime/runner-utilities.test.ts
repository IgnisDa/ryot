import { describe, expect, it } from "vitest";

import { executionError } from "./runner-utilities.sandbox";

describe("sandbox execution errors", () => {
	it("preserves every mapped source frame", () => {
		const frameCount = 12;
		const error = new Error("intentional");
		Object.defineProperty(error, "stack", {
			value: [
				"Error: intentional",
				...Array.from(
					{ length: frameCount },
					(_, index) => `    at script.ts:${index + 1}:${index + 2}`,
				),
			].join("\n"),
		});

		const result = executionError(error, "execute", undefined);

		expect(result.stack?.split("\n")).toHaveLength(frameCount);
		expect(result.stack).toContain("at script.ts:1:2");
		expect(result.stack).toContain(`at script.ts:${frameCount}:${frameCount + 1}`);
	});
});
