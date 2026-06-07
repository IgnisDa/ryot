import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	createSandboxScript,
	enqueueSandboxScript,
	pollSandboxResult,
} from "../fixtures";
import { assertCondition, assertPresent } from "../test-support/assertions";

describe("sandbox result observability", () => {
	it("completed result includes timing with totalMs and executionMs", async () => {
		const { client } = await createAuthenticatedClient();
		const { id: scriptId } = await createSandboxScript(client, {
			name: "observability-check",
			slug: `observability-check-${crypto.randomUUID()}`,
			code: 'driver("main", async function() { return true; });',
		});
		const { jobId } = await enqueueSandboxScript(client, { scriptId, driverName: "main" });

		const result = await pollSandboxResult(client, jobId);
		expect(result.status).toBe("completed");
		assertCondition(result.status === "completed", "Expected sandbox job to complete");

		assertPresent(result.timing, "Expected timing to be present");
		expect(result.timing.totalMs).toBeGreaterThan(0);
		expect(result.timing.executionMs).toBeGreaterThanOrEqual(0);
	});
});
