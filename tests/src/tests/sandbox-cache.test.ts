import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	createSandboxScript,
	enqueueSandboxScript,
	pollSandboxResult,
} from "../fixtures";
import { assertCondition, requireObjectRecord } from "../test-support/assertions";

const requireCompletedSandboxValue = (result: Awaited<ReturnType<typeof pollSandboxResult>>) => {
	expect(result.status).toBe("completed");
	assertCondition(result.status === "completed", "Expected sandbox job to complete");

	expect(result.error).toBeNull();
	return result.value;
};

describe("sandbox cache functions", () => {
	it("setCachedValue stores a value that getCachedValue retrieves within the same script", async () => {
		const { client } = await createAuthenticatedClient();
		const cacheKey = `cache-test-${crypto.randomUUID()}`;
		const { id: scriptId } = await createSandboxScript(client, {
			name: "cache-round-trip",
			slug: `cache-round-trip-${crypto.randomUUID()}`,
			metadata: { allowedHostFunctions: ["setCachedValue", "getCachedValue"] },
			code: `driver("main", async function() {
  const setResult = await setCachedValue(${JSON.stringify(cacheKey)}, { value: 42 }, 60);
  if (!setResult.success) throw new Error(setResult.error);
  return await getCachedValue(${JSON.stringify(cacheKey)});
});`,
		});
		const { jobId } = await enqueueSandboxScript(client, {
			scriptId,
			driverName: "main",
		});

		const value = requireObjectRecord(
			requireCompletedSandboxValue(await pollSandboxResult(client, jobId)),
			"Expected cache write result to be an object",
		);
		expect(value.success).toBe(true);
		expect(value.data).toEqual({ value: 42 });
	});

	it("getCachedValue returns null for a key that was never set", async () => {
		const { client } = await createAuthenticatedClient();
		const missingKey = `cache-missing-${crypto.randomUUID()}`;
		const { id: scriptId } = await createSandboxScript(client, {
			name: "cache-miss",
			slug: `cache-miss-${crypto.randomUUID()}`,
			metadata: { allowedHostFunctions: ["getCachedValue"] },
			code: `driver("main", async function() {
  return await getCachedValue(${JSON.stringify(missingKey)});
});`,
		});
		const { jobId } = await enqueueSandboxScript(client, {
			scriptId,
			driverName: "main",
		});

		const value = requireObjectRecord(
			requireCompletedSandboxValue(await pollSandboxResult(client, jobId)),
			"Expected cache miss result to be an object",
		);
		expect(value.success).toBe(true);
		expect(value.data).toBeNull();
	});

	it("cache is isolated between different scripts for the same key", async () => {
		const { client } = await createAuthenticatedClient();
		const sharedKey = `cache-isolation-${crypto.randomUUID()}`;
		const { id: writerScriptId } = await createSandboxScript(client, {
			name: "cache-writer",
			slug: `cache-writer-${crypto.randomUUID()}`,
			metadata: { allowedHostFunctions: ["setCachedValue"] },
			code: `driver("main", async function() {
  return await setCachedValue(${JSON.stringify(sharedKey)}, { secret: true }, 60);
});`,
		});
		const { id: readerScriptId } = await createSandboxScript(client, {
			name: "cache-reader",
			slug: `cache-reader-${crypto.randomUUID()}`,
			metadata: { allowedHostFunctions: ["getCachedValue"] },
			code: `driver("main", async function() {
  return await getCachedValue(${JSON.stringify(sharedKey)});
});`,
		});

		const { jobId: writeJobId } = await enqueueSandboxScript(client, {
			scriptId: writerScriptId,
			driverName: "main",
		});
		await pollSandboxResult(client, writeJobId);

		const { jobId: readJobId } = await enqueueSandboxScript(client, {
			scriptId: readerScriptId,
			driverName: "main",
		});
		const value = requireObjectRecord(
			requireCompletedSandboxValue(await pollSandboxResult(client, readJobId)),
			"Expected cache isolation read result to be an object",
		);
		expect(value.success).toBe(true);
		expect(value.data).toBeNull();
	});

	it("built-in scripts share a cache partition across users for the same key", async () => {
		const { client: clientA } = await createAuthenticatedClient();
		const { client: clientB } = await createAuthenticatedClient();

		const cacheKey = `builtin-shared-cache-${crypto.randomUUID()}`;

		const { id: writerScriptId } = await createSandboxScript(clientA, {
			name: "builtin-cache-writer",
			slug: `builtin-cache-writer-${crypto.randomUUID()}`,
			metadata: { allowedHostFunctions: ["setCachedValue"] },
			code: `driver("main", async function() {
  return await setCachedValue(${JSON.stringify(cacheKey)}, { sharedValue: true }, 60);
});`,
		});

		const { jobId: writeJobId } = await enqueueSandboxScript(clientA, {
			scriptId: writerScriptId,
			driverName: "main",
		});
		await pollSandboxResult(clientA, writeJobId);

		const { id: readerScriptId } = await createSandboxScript(clientB, {
			name: "builtin-cache-reader",
			slug: `builtin-cache-reader-${crypto.randomUUID()}`,
			metadata: { allowedHostFunctions: ["getCachedValue"] },
			code: `driver("main", async function() {
  return await getCachedValue(${JSON.stringify(cacheKey)});
});`,
		});

		const { jobId: readJobId } = await enqueueSandboxScript(clientB, {
			driverName: "main",
			scriptId: readerScriptId,
		});
		const value = requireObjectRecord(
			requireCompletedSandboxValue(await pollSandboxResult(clientB, readJobId)),
			"Expected cross-user cache result to be an object",
		);
		expect(value.success).toBe(true);
		// User-owned scripts are isolated per scriptId — a different user's script
		// cannot read this user's cache entry even with the same key.
		expect(value.data).toBeNull();
	});
});
