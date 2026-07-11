import {
	jsonByteLength,
	SANDBOX_COMPILER_LIMITS,
	utf8ByteLength,
} from "@ryot/sandbox-compiler/limits";

export { jsonByteLength, utf8ByteLength };

const KiB = 1024;
const MiB = 1024 * KiB;

export const SANDBOX_LIMITS = {
	compiler: SANDBOX_COMPILER_LIMITS,
	hostCalls: { http: 50, total: 200 },
	http: { requestBytes: MiB, responseBytes: 10 * MiB },
	bridge: { requestBytes: MiB, responseBytes: 10 * MiB },
	logs: { entryCount: 500, entryBytes: 8 * KiB, totalBytes: 256 * KiB },
	observability: { entryCount: 500, entryBytes: 8 * KiB, totalBytes: 256 * KiB },
	cache: { keyBytes: 256, valueBytes: 256 * KiB, ttlSeconds: 30 * 24 * 60 * 60 },
	execution: { denoHeapMiB: 256, resultBytes: MiB, requestBytes: 2 * MiB, contextBytes: 256 * KiB },
} as const;

export const SANDBOX_LOG_TRUNCATION_MARKER = "[sandbox logs truncated]";

export const SANDBOX_RUNNER_LIMITS = {
	httpCallCount: SANDBOX_LIMITS.hostCalls.http,
	hostCallCount: SANDBOX_LIMITS.hostCalls.total,
	logEntryBytes: SANDBOX_LIMITS.logs.entryBytes,
	logEntryCount: SANDBOX_LIMITS.logs.entryCount,
	logTotalBytes: SANDBOX_LIMITS.logs.totalBytes,
	resultBytes: SANDBOX_LIMITS.execution.resultBytes,
	logTruncationMarker: SANDBOX_LOG_TRUNCATION_MARKER,
	bridgeRequestBytes: SANDBOX_LIMITS.bridge.requestBytes,
	bridgeResponseBytes: SANDBOX_LIMITS.bridge.responseBytes,
} as const;

export type SandboxHostCallBudget = { http: number; total: number };

export const consumeSandboxHostCall = (budget: SandboxHostCallBudget, functionName: string) => {
	budget.total += 1;
	if (functionName === "httpCall") {
		budget.http += 1;
	}
	if (budget.total > SANDBOX_LIMITS.hostCalls.total) {
		return `Sandbox execution exceeds ${SANDBOX_LIMITS.hostCalls.total} host calls`;
	}
	if (budget.http > SANDBOX_LIMITS.hostCalls.http) {
		return `Sandbox execution exceeds ${SANDBOX_LIMITS.hostCalls.http} httpCall calls`;
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

export const sandboxRunnerRequestError = (request: string) =>
	utf8ByteLength(request) > SANDBOX_LIMITS.execution.requestBytes
		? `Sandbox runner request exceeds ${SANDBOX_LIMITS.execution.requestBytes} UTF-8 bytes`
		: null;

export const sandboxContextError = (context: unknown) => {
	const bytes = jsonByteLength(context);
	return bytes === null || bytes > SANDBOX_LIMITS.execution.contextBytes
		? `Sandbox driver context must be JSON and no larger than ${SANDBOX_LIMITS.execution.contextBytes} UTF-8 bytes`
		: null;
};
