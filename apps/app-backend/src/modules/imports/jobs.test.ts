import { describe, expect, it } from "bun:test";

import { importRunJobData } from "./jobs";

describe("importRunJobData", () => {
	it("accepts generic source payload job data", () => {
		const result = importRunJobData.safeParse({
			runId: "run_1",
			userId: "user_1",
			sourcePayload: { username: "alice" },
		});

		expect(result.success).toBe(true);
	});

	it("accepts legacy queued Trakt username job data", () => {
		const result = importRunJobData.safeParse({
			runId: "run_1",
			userId: "user_1",
			traktUsername: "alice",
		});

		expect(result.success).toBe(true);
	});
});
