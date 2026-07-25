import {
	limitSandboxCompilationDiagnostics,
	sandboxCompilerDiagnostic,
} from "@ryot/sandbox-compiler/diagnostics";
import { describe, expect, it } from "vitest";

import {
	consumeSandboxHostCall,
	jsonByteLength,
	sandboxCacheKeyError,
	sandboxCacheTtlError,
	sandboxCacheValueError,
	sandboxContextError,
	sandboxHttpRequestBodyError,
	sandboxRunnerRequestError,
	SANDBOX_LIMITS,
	sandboxRunnerLimits,
	sandboxWorkflowJournalByteError,
	utf8ByteLength,
	WORKFLOW_SANDBOX_LIMITS,
} from "./limits";

describe("sandbox limits", () => {
	it("keeps every agreed resource limit in one production value", () => {
		expect(SANDBOX_LIMITS).toEqual({
			workerConcurrency: 5,
			hostCalls: { http: 50, total: 200 },
			diagnostics: { stderrBytes: 65_536, stderrLines: 20 },
			logs: { entryBytes: 8_192, entryCount: 500, totalBytes: 262_144 },
			scratch: { maxDepth: 32, maxEntries: 4_096, totalBytes: 5_242_880 },
			cache: { keyBytes: 256, ttlSeconds: 2_592_000, valueBytes: 262_144 },
			observability: { entryBytes: 8_192, entryCount: 500, totalBytes: 262_144 },
			http: { requestBytes: 1_048_576, responseBytes: 10_485_760, timeoutMs: 8_000 },
			userRelationshipWrites: { batches: 50, changesTotal: 500, changesPerBatch: 100 },
			bridge: {
				concurrentHostCalls: 4,
				requestBytes: 1_048_576,
				responseBytes: 10_485_760,
				durableResponseBytes: 105_906_176,
			},
			globalWrites: {
				entityItems: 500,
				relationshipGroups: 50,
				relationshipsTotal: 1_000,
				relationshipsPerGroup: 500,
			},
			execution: {
				denoHeapMiB: 256,
				timeoutMs: 10_000,
				contextBytes: 262_144,
				resultBytes: 1_048_576,
				requestBytes: 2_097_152,
			},
			compiler: {
				concurrency: 2,
				timeoutMs: 5_000,
				diagnosticCount: 100,
				sourceBytes: 262_144,
				manifestBytes: 16_384,
				memoryPollIntervalMs: 5,
				memoryBytes: 268_435_456,
				diagnosticBytes: 262_144,
				javascriptBytes: 1_048_576,
			},
		});
	});

	it("measures string and JSON byte lengths at UTF-8 boundaries", () => {
		expect(utf8ByteLength("abc")).toBe(3);
		expect(utf8ByteLength("a🙂")).toBe(5);
		expect(jsonByteLength({ value: "🙂" })).toBe(16);
	});

	it("applies cache key, value-independent TTL, and context boundaries", () => {
		const circular: Record<string, unknown> = {};
		circular["self"] = circular;
		expect(sandboxCacheKeyError("getCachedValue", "é".repeat(128))).toBeNull();
		expect(sandboxCacheKeyError("getCachedValue", `${"é".repeat(128)}a`)).toContain(
			"256 UTF-8 bytes",
		);
		expect(
			sandboxCacheTtlError("setCachedValue", SANDBOX_LIMITS.cache.ttlSeconds, "expiry"),
		).toBeNull();
		expect(
			sandboxCacheTtlError("setCachedValue", SANDBOX_LIMITS.cache.ttlSeconds + 1, "expiry"),
		).toContain("2592000 seconds");
		expect(
			sandboxCacheValueError("setCachedValue", "🙂".repeat(SANDBOX_LIMITS.cache.valueBytes / 4)),
		).toBeNull();
		expect(
			sandboxCacheValueError(
				"setCachedValue",
				`${"🙂".repeat(SANDBOX_LIMITS.cache.valueBytes / 4)}a`,
			),
		).toContain("262144 UTF-8 bytes");
		expect(sandboxHttpRequestBodyError("a".repeat(SANDBOX_LIMITS.http.requestBytes))).toBeNull();
		expect(
			sandboxHttpRequestBodyError("🙂".repeat(SANDBOX_LIMITS.http.requestBytes / 4 + 1)),
		).toContain("1048576 UTF-8 bytes");
		expect(sandboxRunnerRequestError("a".repeat(SANDBOX_LIMITS.execution.requestBytes))).toBeNull();
		expect(
			sandboxRunnerRequestError("🙂".repeat(SANDBOX_LIMITS.execution.requestBytes / 4 + 1)),
		).toContain("2097152 UTF-8 bytes");
		expect(sandboxContextError("a".repeat(SANDBOX_LIMITS.execution.contextBytes - 2))).toBeNull();
		expect(sandboxContextError("🙂".repeat(SANDBOX_LIMITS.execution.contextBytes / 4))).toContain(
			"262144 UTF-8 bytes",
		);
		expect(sandboxContextError(circular)).toContain("must be JSON");
	});

	it("counts every host and HTTP call attempt against both budgets", () => {
		const totalBudget = { http: 0, total: 0 };
		for (let index = 0; index < SANDBOX_LIMITS.hostCalls.total; index += 1) {
			expect(consumeSandboxHostCall(totalBudget, "getCachedValue")).toBeNull();
		}
		expect(consumeSandboxHostCall(totalBudget, "getCachedValue")).toContain("200 host calls");

		const httpBudget = { http: 0, total: 0 };
		for (let index = 0; index < SANDBOX_LIMITS.hostCalls.http; index += 1) {
			expect(consumeSandboxHostCall(httpBudget, "httpCall")).toBeNull();
		}
		expect(consumeSandboxHostCall(httpBudget, "httpCall")).toContain("50 httpCall calls");
	});

	it("applies the distinct workflow execution profile without changing activity limits", () => {
		expect(WORKFLOW_SANDBOX_LIMITS).toEqual({
			timeoutMs: 30_000,
			journalBytes: 104_857_600,
			hostCalls: { http: 0, total: 1_000 },
			execution: { contextBytes: 65_536, resultBytes: 4_194_304 },
		});
		expect(sandboxRunnerLimits({ kind: "workflow" })).toMatchObject({
			hostCallCount: 1_000,
			resultBytes: 4_194_304,
			bridgeResponseBytes: 10_485_760,
		});
		expect(sandboxRunnerLimits({ kind: "activity" })).toEqual(sandboxRunnerLimits({}));
		expect(sandboxContextError("a".repeat(65_535), { kind: "workflow" })).toContain(
			"65536 UTF-8 bytes",
		);
	});

	it("enforces the cumulative journal boundary including array separators", () => {
		expect(
			sandboxWorkflowJournalByteError(2, WORKFLOW_SANDBOX_LIMITS.journalBytes - 2, 0),
		).toBeNull();
		expect(
			sandboxWorkflowJournalByteError(2, WORKFLOW_SANDBOX_LIMITS.journalBytes - 1, 0),
		).toContain("104857600 UTF-8 bytes");
		expect(
			sandboxWorkflowJournalByteError(WORKFLOW_SANDBOX_LIMITS.journalBytes - 1, 0, 1),
		).toBeNull();
		expect(sandboxWorkflowJournalByteError(WORKFLOW_SANDBOX_LIMITS.journalBytes, 0, 1)).toContain(
			"104857600 UTF-8 bytes",
		);
	});

	it("bounds diagnostics by both entry count and serialized UTF-8 bytes", () => {
		const diagnostics = Array.from({ length: 150 }, (_, index) =>
			sandboxCompilerDiagnostic(`RYOT_${index}`, "🙂".repeat(10_000)),
		);
		const bounded = limitSandboxCompilationDiagnostics(diagnostics);

		expect(bounded.length).toBeLessThanOrEqual(SANDBOX_LIMITS.compiler.diagnosticCount);
		expect(utf8ByteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(
			SANDBOX_LIMITS.compiler.diagnosticBytes,
		);
		expect(bounded[0]?.message.length).toBeGreaterThan(0);
	});
});
