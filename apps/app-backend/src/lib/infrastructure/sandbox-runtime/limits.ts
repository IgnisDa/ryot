import {
	jsonByteLength,
	SANDBOX_COMPILER_LIMITS,
	utf8ByteLength,
} from "@ryot/sandbox-compiler/limits";
import {
	GLOBAL_WRITE_SANDBOX_LIMITS,
	USER_RELATIONSHIP_WRITE_SANDBOX_LIMITS,
} from "@ryot/sandbox-sdk/core";

export { jsonByteLength, utf8ByteLength };

const KiB = 1024;
const MiB = 1024 * KiB;

export const SANDBOX_LIMITS = {
	workerConcurrency: 5,
	compiler: SANDBOX_COMPILER_LIMITS,
	hostCalls: { http: 50, total: 200 },
	harvest: { handleTtlSeconds: 60 * 60 },
	globalWrites: GLOBAL_WRITE_SANDBOX_LIMITS,
	userRelationshipWrites: USER_RELATIONSHIP_WRITE_SANDBOX_LIMITS,
	scratch: { maxDepth: 32, maxEntries: 4_096, totalBytes: 5 * MiB },
	logs: { entryCount: 500, entryBytes: 8 * KiB, totalBytes: 256 * KiB },
	http: { requestBytes: MiB, responseBytes: 10 * MiB, timeoutMs: 8_000 },
	cache: { keyBytes: 256, valueBytes: 256 * KiB, ttlSeconds: 30 * 24 * 60 * 60 },
	bridge: { concurrentHostCalls: 4, requestBytes: MiB, responseBytes: 10 * MiB },
	observability: { entryCount: 500, entryBytes: 8 * KiB, totalBytes: 256 * KiB },
	execution: {
		resultBytes: MiB,
		denoHeapMiB: 256,
		timeoutMs: 10_000,
		requestBytes: 2 * MiB,
		contextBytes: 256 * KiB,
	},
} as const;

export const WORKFLOW_SANDBOX_LIMITS = {
	timeoutMs: 30_000,
	hostCalls: { http: 0, total: 1_000 },
	execution: { contextBytes: 64 * KiB, resultBytes: 4 * MiB },
} as const;

export const SANDBOX_LOG_TRUNCATION_MARKER = "[sandbox logs truncated]";

const makeSandboxRunnerLimits = (workflow: boolean) => ({
	httpCallCount: SANDBOX_LIMITS.hostCalls.http,
	logEntryBytes: SANDBOX_LIMITS.logs.entryBytes,
	logEntryCount: SANDBOX_LIMITS.logs.entryCount,
	logTotalBytes: SANDBOX_LIMITS.logs.totalBytes,
	logTruncationMarker: SANDBOX_LOG_TRUNCATION_MARKER,
	bridgeRequestBytes: SANDBOX_LIMITS.bridge.requestBytes,
	bridgeResponseBytes: SANDBOX_LIMITS.bridge.responseBytes,
	hostCallCount: workflow
		? WORKFLOW_SANDBOX_LIMITS.hostCalls.total
		: SANDBOX_LIMITS.hostCalls.total,
	resultBytes: workflow
		? WORKFLOW_SANDBOX_LIMITS.execution.resultBytes
		: SANDBOX_LIMITS.execution.resultBytes,
});

export const SANDBOX_RUNNER_LIMITS = makeSandboxRunnerLimits(false);
export const WORKFLOW_SANDBOX_RUNNER_LIMITS = makeSandboxRunnerLimits(true);

export const isWorkflowSandboxMetadata = (metadata: unknown) =>
	typeof metadata === "object" &&
	metadata !== null &&
	"kind" in metadata &&
	metadata.kind === "workflow";

export const sandboxRunnerLimits = (metadata: unknown) =>
	isWorkflowSandboxMetadata(metadata) ? WORKFLOW_SANDBOX_RUNNER_LIMITS : SANDBOX_RUNNER_LIMITS;

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
		return `Sandbox execution exceeds ${totalLimit} host calls`;
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

export const sandboxScratchQuotaError = (usedBytes: number) =>
	usedBytes > SANDBOX_LIMITS.scratch.totalBytes
		? `Sandbox scratch directory uses ${usedBytes} bytes and exceeds the ${SANDBOX_LIMITS.scratch.totalBytes} byte quota`
		: null;

export const sandboxRunnerRequestError = (request: string) =>
	utf8ByteLength(request) > SANDBOX_LIMITS.execution.requestBytes
		? `Sandbox runner request exceeds ${SANDBOX_LIMITS.execution.requestBytes} UTF-8 bytes`
		: null;

export const sandboxContextError = (context: unknown, metadata?: unknown) => {
	const bytes = jsonByteLength(context);
	const limit = isWorkflowSandboxMetadata(metadata)
		? WORKFLOW_SANDBOX_LIMITS.execution.contextBytes
		: SANDBOX_LIMITS.execution.contextBytes;
	return bytes === null || bytes > limit
		? `Sandbox definition context must be JSON and no larger than ${limit} UTF-8 bytes`
		: null;
};
