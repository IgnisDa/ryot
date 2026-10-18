import {
	limitSandboxCompilationDiagnostics,
	pluginBackendCompilerDiagnostic,
} from "@ryot-app/plugin-backend-compiler/diagnostics";
import { utf8ByteLength } from "@ryot-app/plugin-backend-compiler/limits";
import { describe, expect, it } from "vitest";

import {
	chargeSandboxHostCall,
	consumeSandboxHostCall,
	SANDBOX_LIMITS,
	sandboxCacheKeyError,
	sandboxCacheTtlError,
	sandboxCacheValueError,
	sandboxContextError,
	sandboxHttpRequestBodyError,
	sandboxWorkflowJournalByteError,
} from "./limits";

describe("sandbox limits", () => {
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
		const exactContext = "a".repeat(SANDBOX_LIMITS.execution.contextBytes - 2);
		const oversizedContext = `${exactContext}a`;
		expect(sandboxContextError(exactContext)).toBeNull();
		expect(sandboxContextError(oversizedContext)).toBe(
			"Sandbox definition context is 65537 UTF-8 bytes and exceeds 65536 UTF-8 bytes",
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

	it("charges the isolate's budget by arithmetic alone and leaves the capability lookup to the host", () => {
		const budget = { http: 0, total: SANDBOX_LIMITS.hostCalls.total };

		expect(chargeSandboxHostCall(budget, "not-a-capability")).toBe(
			"Sandbox execution exceeds 1000 host calls",
		);
		expect(
			consumeSandboxHostCall(
				{ http: 0, total: SANDBOX_LIMITS.hostCalls.total },
				"not-a-capability",
			),
		).toEqual({
			reason: { code: "execution-limit" },
			message: "Sandbox execution exceeds 1000 host calls",
		});
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
			pluginBackendCompilerDiagnostic(`RYOT_${index}`, "🙂".repeat(10_000)),
		);
		const bounded = limitSandboxCompilationDiagnostics(diagnostics);

		expect(bounded.length).toBeLessThanOrEqual(SANDBOX_LIMITS.compiler.diagnosticCount);
		expect(utf8ByteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(
			SANDBOX_LIMITS.compiler.diagnosticBytes,
		);
		expect(bounded[0]?.message.length).toBeGreaterThan(0);
	});
});
