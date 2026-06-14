import { describe, expect, it } from "bun:test";

import {
	cacheSandboxSource,
	createAuthenticatedClient,
	createSandboxScript,
	enqueueSandboxScript,
	pollSandboxResult,
	requireCompletedSandboxValue,
} from "~/fixtures";
import { requireObjectRecord } from "~/support/assertions";

describe("sandbox cache functions", () => {
	it("setCachedValue stores a value that getCachedValue retrieves within the same script", async () => {
		const { client } = await createAuthenticatedClient();
		const cacheKey = `cache-test-${crypto.randomUUID()}`;
		const slug = `cache-round-trip-${crypto.randomUUID()}`;
		const { id: scriptId } = await createSandboxScript(client, {
			source: cacheSandboxSource({
				slug,
				key: cacheKey,
				ttlSeconds: 60,
				value: { value: 42 },
				operation: "roundTrip",
				name: "cache-round-trip",
			}),
		});
		const { jobId } = await enqueueSandboxScript(client, { scriptId, driverName: "main" });

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
		const slug = `cache-miss-${crypto.randomUUID()}`;
		const { id: scriptId } = await createSandboxScript(client, {
			source: cacheSandboxSource({
				slug,
				key: missingKey,
				operation: "get",
				name: "cache-miss",
			}),
		});
		const { jobId } = await enqueueSandboxScript(client, { scriptId, driverName: "main" });

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
		const writerSlug = `cache-writer-${crypto.randomUUID()}`;
		const { id: writerScriptId } = await createSandboxScript(client, {
			source: cacheSandboxSource({
				key: sharedKey,
				ttlSeconds: 60,
				slug: writerSlug,
				operation: "set",
				name: "cache-writer",
				value: { secret: true },
			}),
		});
		const readerSlug = `cache-reader-${crypto.randomUUID()}`;
		const { id: readerScriptId } = await createSandboxScript(client, {
			source: cacheSandboxSource({
				key: sharedKey,
				slug: readerSlug,
				operation: "get",
				name: "cache-reader",
			}),
		});

		const { jobId: writeJobId } = await enqueueSandboxScript(client, {
			driverName: "main",
			scriptId: writerScriptId,
		});
		await pollSandboxResult(client, writeJobId);

		const { jobId: readJobId } = await enqueueSandboxScript(client, {
			driverName: "main",
			scriptId: readerScriptId,
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

		const writerSlug = `builtin-cache-writer-${crypto.randomUUID()}`;
		const { id: writerScriptId } = await createSandboxScript(clientA, {
			source: cacheSandboxSource({
				key: cacheKey,
				ttlSeconds: 60,
				slug: writerSlug,
				operation: "set",
				name: "builtin-cache-writer",
				value: { sharedValue: true },
			}),
		});

		const { jobId: writeJobId } = await enqueueSandboxScript(clientA, {
			scriptId: writerScriptId,
			driverName: "main",
		});
		await pollSandboxResult(clientA, writeJobId);

		const readerSlug = `builtin-cache-reader-${crypto.randomUUID()}`;
		const { id: readerScriptId } = await createSandboxScript(clientB, {
			source: cacheSandboxSource({
				key: cacheKey,
				slug: readerSlug,
				operation: "get",
				name: "builtin-cache-reader",
			}),
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
		expect(value.data).toBeNull();
	});
});
