import type { SandboxBoundaryReason } from "@ryot-app/contract/modules/scripts/boundary-reason";
import { SANDBOX_HOST_CAPABILITIES } from "@ryot-app/contract/modules/scripts/wire";
import {
	jsonByteLength,
	SANDBOX_COMPILER_LIMITS,
	utf8ByteLength,
} from "@ryot-app/plugin-backend-compiler/limits";
import {
	GLOBAL_WRITE_SANDBOX_LIMITS,
	USER_RELATIONSHIP_WRITE_SANDBOX_LIMITS,
} from "@ryot-app/plugin-backend-sdk/core";

export const KiB = 1024;
export const MiB = 1024 * KiB;

const CONCURRENT_HOST_CALLS = 4;

export const SANDBOX_LIMITS = {
	ryotqlResultBytes: MiB,
	journalBytes: 100 * MiB,
	replay: { shortWaitMs: 1_000 },
	compiler: SANDBOX_COMPILER_LIMITS,
	diagnostics: { messageBytes: 64 * KiB },
	globalWrites: GLOBAL_WRITE_SANDBOX_LIMITS,
	hostCalls: { http: 50, total: 1_000, userSettingsWrites: 4 },
	userRelationshipWrites: USER_RELATIONSHIP_WRITE_SANDBOX_LIMITS,
	logs: { entryCount: 500, entryBytes: 8 * KiB, totalBytes: 256 * KiB },
	journalReads: { count: 2_048, sliceBytes: MiB, totalBytes: 200 * MiB },
	isolate: { cpuMs: 30_000, heapBytes: 64 * MiB, externalBytes: 16 * MiB },
	scratch: { maxEntries: 4_096, totalBytes: 5 * MiB, chunkBytes: 256 * KiB },
	cache: { keyBytes: 256, valueBytes: 256 * KiB, ttlSeconds: 30 * 24 * 60 * 60 },
	observability: { entryCount: 500, entryBytes: 8 * KiB, totalBytes: 256 * KiB },
	http: {
		timeoutMs: 8_000,
		requestBytes: MiB,
		responseBytes: 10 * MiB,
		coordinationBackoffMs: 30_000,
	},
	execution: {
		timeoutMs: 30_000,
		resultBytes: 4 * MiB,
		requestBytes: 2 * MiB,
		contextBytes: 64 * KiB,
	},
	bridge: {
		requestBytes: MiB,
		responseBytes: 10 * MiB,
		durableResponseBytes: 12 * MiB,
		concurrentHostCalls: CONCURRENT_HOST_CALLS,
		// Four slotted calls plus one blocking inline batch.
		outstandingHostCalls: CONCURRENT_HOST_CALLS + 1,
	},
	sidecar: {
		idleMs: 60_000,
		stableMs: 60_000,
		startupMs: 10_000,
		disposalMs: 2_000,
		absoluteMs: 300_000,
		settlementMs: 30_000,
		monitorIntervalMs: 1_000,
		restartBackoffMs: 30_000,
		heapHeadroomBytes: 64 * MiB,
		rssCeilingBytes: 1536 * MiB,
		rssOverheadBytes: 128 * MiB,
		probationAdmissionMs: 20_000,
		queuedBytesPerThread: 52 * MiB,
		bufferedBytesPerThread: 14 * MiB,
	},
} as const;

export const SANDBOX_LOG_TRUNCATION_MARKER = "[sandbox logs truncated]";

export const sandboxHostCallLimitMessage = (limit: number) =>
	`Sandbox execution exceeds ${limit} host calls`;

export const sandboxHttpCallLimitMessage = (limit: number) =>
	`Sandbox execution exceeds ${limit} httpCall calls`;

const executionLimit = (
	message: string,
	functionName: string,
): { message: string; reason: SandboxBoundaryReason } => {
	const operation = SANDBOX_HOST_CAPABILITIES.find((capability) => capability === functionName);
	return {
		message,
		reason: { ...(operation === undefined ? {} : { operation }), code: "execution-limit" },
	};
};

export const sandboxUserSettingsWriteLimitMessage = (limit: number) =>
	`Sandbox execution exceeds ${limit} updateUserSettings calls`;

export type SandboxHostCallBudget = { http: number; total: number; userSettingsWrites: number };

export const chargeSandboxHostCall = (budget: SandboxHostCallBudget, functionName: string) => {
	budget.total += 1;
	if (functionName === "httpCall") {
		budget.http += 1;
	}
	if (functionName === "updateUserSettings") {
		budget.userSettingsWrites += 1;
	}
	if (budget.total > SANDBOX_LIMITS.hostCalls.total) {
		return sandboxHostCallLimitMessage(SANDBOX_LIMITS.hostCalls.total);
	}
	if (budget.http > SANDBOX_LIMITS.hostCalls.http) {
		return sandboxHttpCallLimitMessage(SANDBOX_LIMITS.hostCalls.http);
	}
	if (budget.userSettingsWrites > SANDBOX_LIMITS.hostCalls.userSettingsWrites) {
		return sandboxUserSettingsWriteLimitMessage(SANDBOX_LIMITS.hostCalls.userSettingsWrites);
	}
	return null;
};

export const consumeSandboxHostCall = (budget: SandboxHostCallBudget, functionName: string) => {
	const message = chargeSandboxHostCall(budget, functionName);
	return message === null ? null : executionLimit(message, functionName);
};

export const sandboxCacheKeyError = (fnName: string, key: string) => {
	if (!key.trim()) {
		return `${fnName} expects a non-empty key string`;
	}
	if (utf8ByteLength(key.trim()) > SANDBOX_LIMITS.cache.keyBytes) {
		return `${fnName} key exceeds ${SANDBOX_LIMITS.cache.keyBytes} UTF-8 bytes`;
	}
	return null;
};

export const sandboxCacheTtlError = (fnName: string, ttlSeconds: number, label: string) => {
	if (ttlSeconds <= 0) {
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

export const sandboxWorkflowJournalByteError = (
	journalBytes: number,
	entryBytes: number,
	entryCount: number,
) => {
	if (entryBytes > SANDBOX_LIMITS.bridge.durableResponseBytes) {
		return `Sandbox workflow durable journal entry exceeds ${SANDBOX_LIMITS.bridge.durableResponseBytes} UTF-8 bytes`;
	}
	return journalBytes + entryBytes + (entryCount === 0 ? 0 : 1) > SANDBOX_LIMITS.journalBytes
		? `Sandbox workflow durable journal exceeds ${SANDBOX_LIMITS.journalBytes} UTF-8 bytes`
		: null;
};

export const sandboxContextError = (context: unknown) => {
	const bytes = jsonByteLength(context);
	const limit = SANDBOX_LIMITS.execution.contextBytes;
	if (bytes === null) {
		return "Sandbox definition context must be JSON";
	}
	return bytes > limit
		? `Sandbox definition context is ${bytes} UTF-8 bytes and exceeds ${limit} UTF-8 bytes`
		: null;
};
