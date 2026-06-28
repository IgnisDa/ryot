import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	createSandboxScript,
	enqueueSandboxScript,
	literalSandboxSource,
	pollSandboxResult,
} from "../fixtures";
import { assertCompleted, assertPresent } from "../test-support/assertions";

describe("sandbox result observability", () => {
	it("completed result includes timing with totalMs and executionMs", async () => {
		const { client } = await createAuthenticatedClient();
		const slug = `observability-check-${crypto.randomUUID()}`;
		const { id: scriptId } = await createSandboxScript(client, {
			source: literalSandboxSource({ name: "Observability check", slug, value: true }),
		});
		const { jobId } = await enqueueSandboxScript(client, { scriptId, driverName: "main" });

		const result = await pollSandboxResult(client, jobId);
		assertCompleted(result, "sandbox job");

		assertPresent(result.timing, "Expected timing to be present");
		expect(result.timing.totalMs).toBeGreaterThan(0);
		expect(result.timing.executionMs).toBeGreaterThanOrEqual(0);
	});
});
