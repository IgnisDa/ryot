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
	truncateUtf8,
	utf8ByteLength,
} from "./limits";

describe("sandbox limits", () => {
	it("keeps every agreed resource limit in one production value", () => {
		expect(SANDBOX_LIMITS).toEqual({
			hostCalls: { http: 50, total: 200 },
			http: { requestBytes: 1_048_576, responseBytes: 10_485_760 },
			bridge: { requestBytes: 1_048_576, responseBytes: 10_485_760 },
			logs: { entryBytes: 8_192, entryCount: 500, totalBytes: 262_144 },
			cache: { keyBytes: 256, ttlSeconds: 2_592_000, valueBytes: 262_144 },
			execution: {
				denoHeapMiB: 256,
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

	it("measures and truncates strings at UTF-8 boundaries", () => {
		expect(utf8ByteLength("abc")).toBe(3);
		expect(utf8ByteLength("a🙂")).toBe(5);
		expect(truncateUtf8("a🙂b", 5)).toBe("a🙂");
		expect(truncateUtf8("a🙂b", 4)).toBe("a");
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
