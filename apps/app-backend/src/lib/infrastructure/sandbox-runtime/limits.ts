import {
	jsonByteLength,
	SANDBOX_COMPILER_LIMITS,
	utf8ByteLength,
} from "@ryot/sandbox-compiler/limits";
import {
	GLOBAL_WRITE_SANDBOX_LIMITS,
	USER_RELATIONSHIP_WRITE_SANDBOX_LIMITS,
} from "@ryot/sandbox-sdk/core";

const KiB = 1024;
const MiB = 1024 * KiB;

export const SANDBOX_LIMITS = {
	workerConcurrency: 5,
	journalBytes: 100 * MiB,
	compiler: SANDBOX_COMPILER_LIMITS,
	hostCalls: { http: 50, total: 1_000 },
	globalWrites: GLOBAL_WRITE_SANDBOX_LIMITS,
	diagnostics: { stderrBytes: 64 * KiB, stderrLines: 20 },
	userRelationshipWrites: USER_RELATIONSHIP_WRITE_SANDBOX_LIMITS,
	scratch: { maxDepth: 32, maxEntries: 4_096, totalBytes: 5 * MiB },
	logs: { entryCount: 500, entryBytes: 8 * KiB, totalBytes: 256 * KiB },
	http: { requestBytes: MiB, responseBytes: 10 * MiB, timeoutMs: 8_000 },
	cache: { keyBytes: 256, valueBytes: 256 * KiB, ttlSeconds: 30 * 24 * 60 * 60 },
	observability: { entryCount: 500, entryBytes: 8 * KiB, totalBytes: 256 * KiB },
	bridge: {
		requestBytes: MiB,
		concurrentHostCalls: 4,
		responseBytes: 10 * MiB,
		durableResponseBytes: 101 * MiB,
	},
	execution: {
		denoHeapMiB: 256,
		timeoutMs: 30_000,
		resultBytes: 4 * MiB,
		requestBytes: 2 * MiB,
		contextBytes: 64 * KiB,
	},
} as const;

export const SANDBOX_LOG_TRUNCATION_MARKER = "[sandbox logs truncated]";

export const sandboxHostCallLimitMessage = (limit: number) =>
	`Sandbox execution exceeds ${limit} host calls`;

export const sandboxHttpCallLimitMessage = (limit: number) =>
	`Sandbox execution exceeds ${limit} httpCall calls`;

export const SANDBOX_RUNNER_LIMITS = {
	httpCallCount: SANDBOX_LIMITS.hostCalls.http,
	logEntryBytes: SANDBOX_LIMITS.logs.entryBytes,
	logEntryCount: SANDBOX_LIMITS.logs.entryCount,
	logTotalBytes: SANDBOX_LIMITS.logs.totalBytes,
	hostCallCount: SANDBOX_LIMITS.hostCalls.total,
	resultBytes: SANDBOX_LIMITS.execution.resultBytes,
	logTruncationMarker: SANDBOX_LOG_TRUNCATION_MARKER,
	bridgeRequestBytes: SANDBOX_LIMITS.bridge.requestBytes,
	bridgeResponseBytes: SANDBOX_LIMITS.bridge.responseBytes,
	durableBridgeResponseBytes: SANDBOX_LIMITS.bridge.durableResponseBytes,
	httpCallLimitMessage: sandboxHttpCallLimitMessage(SANDBOX_LIMITS.hostCalls.http),
	hostCallLimitMessage: sandboxHostCallLimitMessage(SANDBOX_LIMITS.hostCalls.total),
};

export type SandboxHostCallBudget = { http: number; total: number };

export const consumeSandboxHostCall = (
	budget: SandboxHostCallBudget,
	functionName: string,
	totalLimit: number = SANDBOX_LIMITS.hostCalls.total,
) => {
	budget.total += 1;
	if (functionName === "httpCall") {
		budget.http += 1;
	}
	if (budget.total > totalLimit) {
		return sandboxHostCallLimitMessage(totalLimit);
	}
	if (budget.http > SANDBOX_LIMITS.hostCalls.http) {
		return sandboxHttpCallLimitMessage(SANDBOX_LIMITS.hostCalls.http);
	}
	return null;
};

export const sandboxCacheKeyError = (fnName: string, key: unknown) => {
	if (typeof key !== "string" || !key.trim()) {
		return `${fnName} expects a non-empty key string`;
	}
	if (utf8ByteLength(key.trim()) > SANDBOX_LIMITS.cache.keyBytes) {
		return `${fnName} key exceeds ${SANDBOX_LIMITS.cache.keyBytes} UTF-8 bytes`;
	}
	return null;
};

export const sandboxCacheTtlError = (fnName: string, ttlSeconds: unknown, label: string) => {
	if (typeof ttlSeconds !== "number" || !Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
		return `${fnName} expects a positive integer ${label} in seconds`;
	}
	if (ttlSeconds > SANDBOX_LIMITS.cache.ttlSeconds) {
		return `${fnName} ${label} exceeds ${SANDBOX_LIMITS.cache.ttlSeconds} seconds`;
	}
	return null;
};

export const sandboxCacheValueError = (fnName: string, serialized: string, label = "value") =>
	utf8ByteLength(serialized) > SANDBOX_LIMITS.cache.valueBytes
		? `${fnName} ${label} exceeds ${SANDBOX_LIMITS.cache.valueBytes} UTF-8 bytes`
		: null;

export const sandboxHttpRequestBodyError = (body: string | undefined) =>
	body !== undefined && utf8ByteLength(body) > SANDBOX_LIMITS.http.requestBytes
		? `httpCall request body exceeds ${SANDBOX_LIMITS.http.requestBytes} UTF-8 bytes`
		: null;

export const sandboxScratchQuotaError = (usedBytes: number) =>
	usedBytes > SANDBOX_LIMITS.scratch.totalBytes
		? `Sandbox scratch directory uses ${usedBytes} bytes and exceeds the ${SANDBOX_LIMITS.scratch.totalBytes} byte quota`
		: null;

export const sandboxRunnerRequestError = (request: string) =>
	utf8ByteLength(request) > SANDBOX_LIMITS.execution.requestBytes
		? `Sandbox runner request exceeds ${SANDBOX_LIMITS.execution.requestBytes} UTF-8 bytes`
		: null;

export const sandboxWorkflowJournalByteError = (
	journalBytes: number,
	entryBytes: number,
	entryCount: number,
) =>
	journalBytes + entryBytes + (entryCount === 0 ? 0 : 1) > SANDBOX_LIMITS.journalBytes
		? `Sandbox workflow durable journal exceeds ${SANDBOX_LIMITS.journalBytes} UTF-8 bytes`
		: null;

export const sandboxContextError = (context: unknown) => {
	const bytes = jsonByteLength(context);
	const limit = SANDBOX_LIMITS.execution.contextBytes;
	return bytes === null || bytes > limit
		? `Sandbox definition context must be JSON and no larger than ${limit} UTF-8 bytes`
		: null;
};
