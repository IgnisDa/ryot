import {
	limitSandboxCompilationDiagnostics,
	sandboxCompilerDiagnostic,
} from "@ryot-app/sandbox-compiler/diagnostics";
import { jsonByteLength, utf8ByteLength } from "@ryot-app/sandbox-compiler/limits";
import { describe, expect, it } from "vitest";

import {
	consumeSandboxHostCall,
	sandboxCacheKeyError,
	sandboxCacheTtlError,
	sandboxCacheValueError,
	sandboxContextError,
	sandboxHttpRequestBodyError,
	sandboxRunnerRequestError,
	SANDBOX_LIMITS,
	SANDBOX_RUNNER_LIMITS,
	sandboxWorkflowJournalByteError,
} from "./limits";

describe("sandbox limits", () => {
	it("keeps every agreed resource limit in one production value", () => {
		expect(SANDBOX_LIMITS).toEqual({
			journalBytes: 104_857_600,
			ryotqlResultBytes: 1_048_576,
			hostCalls: { http: 50, total: 1_000 },
			diagnostics: { messageBytes: 65_536 },
			logs: { entryCount: 500, entryBytes: 8_192, totalBytes: 262_144 },
			cache: { keyBytes: 256, valueBytes: 262_144, ttlSeconds: 2_592_000 },
			scratch: { maxEntries: 4_096, chunkBytes: 262_144, totalBytes: 5_242_880 },
			observability: { entryCount: 500, entryBytes: 8_192, totalBytes: 262_144 },
			isolate: { cpuMs: 30_000, heapBytes: 67_108_864, externalBytes: 16_777_216 },
			journalReads: { count: 2_048, sliceBytes: 1_048_576, totalBytes: 209_715_200 },
			userRelationshipWrites: { batches: 50, changesTotal: 500, changesPerBatch: 100 },
			execution: {
				timeoutMs: 30_000,
				contextBytes: 65_536,
				resultBytes: 4_194_304,
				requestBytes: 2_097_152,
			},
			http: {
				timeoutMs: 8_000,
				requestBytes: 1_048_576,
				responseBytes: 10_485_760,
				coordinationBackoffMs: 30_000,
			},
			globalWrites: {
				entityItems: 500,
				relationshipGroups: 50,
				relationshipsTotal: 1_000,
				relationshipsPerGroup: 500,
			},
			bridge: {
				concurrentHostCalls: 4,
				requestBytes: 1_048_576,
				responseBytes: 10_485_760,
				durableResponseBytes: 12_582_912,
			},
			compiler: {
				concurrency: 2,
				timeoutMs: 5_000,
				diagnosticCount: 100,
				sourceBytes: 262_144,
				manifestBytes: 16_384,
				memoryPollIntervalMs: 5,
				memoryBytes: 402_653_184,
				diagnosticBytes: 262_144,
				javascriptBytes: 1_048_576,
				executionAnalysisSteps: 100_000,
			},
			sidecar: {
				idleMs: 60_000,
				stableMs: 60_000,
				startupMs: 10_000,
				disposalMs: 2_000,
				absoluteMs: 300_000,
				settlementMs: 30_000,
				heapHeadroomBytes: 67_108_864,
				rssOverheadBytes: 134_217_728,
				rssCeilingBytes: 1_610_612_736,
				queuedBytesPerThread: 54_525_952,
				bufferedBytesPerThread: 14_680_064,
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
		const exactContext = "a".repeat(SANDBOX_LIMITS.execution.contextBytes - 2);
		const oversizedContext = `${exactContext}a`;
		expect(jsonByteLength(exactContext)).toBe(65_536);
		expect(sandboxContextError(exactContext)).toBeNull();
		expect(jsonByteLength(oversizedContext)).toBe(65_537);
		expect(sandboxContextError(oversizedContext)).toBe(
			"Sandbox definition context is 65537 UTF-8 bytes and exceeds 65536 UTF-8 bytes",
		);
		expect(sandboxContextError("🙂".repeat(SANDBOX_LIMITS.execution.contextBytes / 4))).toContain(
			"65536 UTF-8 bytes",
		);
		expect(sandboxContextError(circular)).toContain("must be JSON");
		expect(sandboxContextError(circular)).not.toContain("65536");
		expect(sandboxContextError("🙂".repeat(SANDBOX_LIMITS.execution.contextBytes / 4))).toBe(
			"Sandbox definition context is 65538 UTF-8 bytes and exceeds 65536 UTF-8 bytes",
		);
	});

	it("counts every host and HTTP call attempt against both budgets", () => {
		const totalBudget = { http: 0, total: 0 };
		for (let index = 0; index < SANDBOX_LIMITS.hostCalls.total; index += 1) {
			expect(consumeSandboxHostCall(totalBudget, "getCachedValue")).toBeNull();
		}
		expect(consumeSandboxHostCall(totalBudget, "getCachedValue")).toMatchObject({
			message: expect.stringContaining("1000 host calls"),
			reason: { code: "execution-limit", operation: "getCachedValue" },
		});

		const httpBudget = { http: 0, total: 0 };
		for (let index = 0; index < SANDBOX_LIMITS.hostCalls.http; index += 1) {
			expect(consumeSandboxHostCall(httpBudget, "httpCall")).toBeNull();
		}
		expect(consumeSandboxHostCall(httpBudget, "httpCall")).toMatchObject({
			message: expect.stringContaining("50 httpCall calls"),
			reason: { operation: "httpCall", code: "execution-limit" },
		});
	});

	it("applies one universal execution profile", () => {
		expect(SANDBOX_RUNNER_LIMITS).toMatchObject({
			hostCallCount: 1_000,
			resultBytes: 4_194_304,
			bridgeResponseBytes: 10_485_760,
		});
		expect(sandboxContextError("a".repeat(65_535))).toContain("65536 UTF-8 bytes");
	});

	it("enforces the per-entry and cumulative journal boundaries including array separators", () => {
		const entryLimit = SANDBOX_LIMITS.bridge.durableResponseBytes;
		expect(sandboxWorkflowJournalByteError(2, entryLimit, 0)).toBeNull();
		expect(sandboxWorkflowJournalByteError(2, entryLimit + 1, 0)).toBe(
			"Sandbox workflow durable journal entry exceeds 12582912 UTF-8 bytes",
		);
		expect(sandboxWorkflowJournalByteError(SANDBOX_LIMITS.journalBytes - 3, 2, 1)).toBeNull();
		expect(sandboxWorkflowJournalByteError(SANDBOX_LIMITS.journalBytes - 2, 2, 1)).toBe(
			"Sandbox workflow durable journal exceeds 104857600 UTF-8 bytes",
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
