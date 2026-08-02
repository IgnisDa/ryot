import { utf8ByteLength } from "@ryot/sandbox-compiler/limits";
import type { LogEntry, SpanEntry } from "@ryot/sandbox-sdk/core";
import { stableStringify } from "@ryot/ts-utils/json";
import { Effect, Match } from "effect";

import { SANDBOX_LIMITS } from "./limits";
import type { SandboxHostImplementationMap, SandboxRunInput } from "./shared";
import { sandboxHostFailure } from "./shared";

type ObservabilityKind = "log" | "span";
type ObservabilityEntry = LogEntry | SpanEntry;
const sensitiveAttributePattern =
	/authorization|cookie|credential|password|secret|token|api[-_]?key/i;
const redactedValue = "[REDACTED]";
const sensitiveTextPattern =
	/(authorization|cookie|credential|password|secret|token|api[-_]?key)(\s*[:=]\s*)(?:Bearer\s+[A-Za-z0-9._~+/=-]+|"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const bearerTextPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

const redactDiagnosticText = (value: string) =>
	value
		.replace(
			sensitiveTextPattern,
			(_match, key: string, separator: string) => `${key}${separator}${redactedValue}`,
		)
		.replace(bearerTextPattern, `Bearer ${redactedValue}`);

const redactValue = (value: unknown, key?: string): unknown => {
	if (key && sensitiveAttributePattern.test(key)) {
		return redactedValue;
	}
	if (Array.isArray(value)) {
		return value.map((entry) => redactValue(entry));
	}
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([entryKey, entry]) => [entryKey, redactValue(entry, entryKey)]),
		);
	}
	return value;
};

const redactAttributes = (attributes: Readonly<Record<string, unknown>> | undefined) =>
	Object.fromEntries(
		Object.entries(attributes ?? {}).map(([key, value]) => [key, redactValue(value, key)]),
	);

const serializeObservabilityEntry = (entry: ObservabilityEntry) => {
	if ("level" in entry) {
		return stableStringify({
			kind: "log",
			level: entry.level,
			message: redactDiagnosticText(entry.message),
			...(entry.attributes ? { attributes: redactAttributes(entry.attributes) } : {}),
		});
	}

	return stableStringify({
		kind: "span",
		name: redactDiagnosticText(entry.name),
		...(entry.attributes ? { attributes: redactAttributes(entry.attributes) } : {}),
	});
};

export const makeSandboxObservabilityCollector = () => {
	const logs: string[] = [];
	let totalBytes = 0;

	function record(kind: "log", entries: ReadonlyArray<LogEntry>): string | null;
	function record(kind: "span", entries: ReadonlyArray<SpanEntry>): string | null;
	function record(_kind: ObservabilityKind, entries: ReadonlyArray<ObservabilityEntry>) {
		const serialized = entries.map(serializeObservabilityEntry);
		const oversized = serialized.find(
			(entry) => utf8ByteLength(entry) > SANDBOX_LIMITS.observability.entryBytes,
		);
		if (oversized) {
			return `Sandbox observability entry exceeds ${SANDBOX_LIMITS.observability.entryBytes} UTF-8 bytes`;
		}
		if (logs.length + serialized.length > SANDBOX_LIMITS.observability.entryCount) {
			return `Sandbox execution exceeds ${SANDBOX_LIMITS.observability.entryCount} observability entries`;
		}
		const batchBytes = serialized.reduce((total, entry) => total + utf8ByteLength(entry), 0);
		if (totalBytes + batchBytes > SANDBOX_LIMITS.observability.totalBytes) {
			return `Sandbox observability entries exceed ${SANDBOX_LIMITS.observability.totalBytes} UTF-8 bytes`;
		}

		logs.push(...serialized);
		totalBytes += batchBytes;
		return null;
	}

	return { record, logs };
};

export type SandboxObservabilityCollector = ReturnType<typeof makeSandboxObservabilityCollector>;

const correlationAttributes = (input: SandboxRunInput) => ({
	scriptId: input.scriptId,
	executionId: input.executionId,
	...(input.workflowExecutionId ? { sandboxWorkflowExecutionId: input.workflowExecutionId } : {}),
});

const emitLog = (input: SandboxRunInput, entry: LogEntry) => {
	const message = redactDiagnosticText(entry.message);
	const effect = Match.value(entry.level).pipe(
		Match.when("debug", () => Effect.logDebug(message)),
		Match.when("info", () => Effect.logInfo(message)),
		Match.when("error", () => Effect.logError(message)),
		Match.when("warning", () => Effect.logWarning(message)),
		Match.exhaustive,
	);
	return effect.pipe(
		Effect.annotateLogs({ ...redactAttributes(entry.attributes), ...correlationAttributes(input) }),
	);
};

export const makeObservabilitySandboxApiFunctions = (
	collector: SandboxObservabilityCollector,
): Pick<SandboxHostImplementationMap, "log" | "span"> => ({
	log: (input, entries) =>
		Effect.sync(() => collector.record("log", entries)).pipe(
			Effect.flatMap((error) =>
				error
					? sandboxHostFailure(error)
					: Effect.forEach(entries, (entry) => emitLog(input, entry), { discard: true }),
			),
			Effect.as(null),
		),
	span: (input, entries) =>
		Effect.sync(() => collector.record("span", entries)).pipe(
			Effect.flatMap((error) =>
				error
					? sandboxHostFailure(error)
					: Effect.forEach(
							entries,
							(entry) =>
								Effect.void.pipe(
									Effect.withSpan(redactDiagnosticText(entry.name), {
										attributes: {
											...redactAttributes(entry.attributes),
											...correlationAttributes(input),
										},
									}),
								),
							{ discard: true },
						),
			),
			Effect.as(null),
		),
});

export const mergeSandboxExecutionLogs = (
	consoleLogs: readonly string[],
	collector: SandboxObservabilityCollector,
) => [...consoleLogs.map(redactDiagnosticText), ...collector.logs];
