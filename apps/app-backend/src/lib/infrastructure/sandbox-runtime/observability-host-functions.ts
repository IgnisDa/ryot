import type { LogEntry, SpanEntry } from "@ryot/sandbox-sdk/core";
import { stableStringify } from "@ryot/ts-utils/json";
import { Effect, Match } from "effect";

import { SANDBOX_LIMITS, utf8ByteLength } from "./limits";
import type { SandboxHostImplementationMap, SandboxRunInput } from "./shared";
import { sandboxHostFailure } from "./shared";

type ObservabilityKind = "log" | "span";
type ObservabilityEntry = LogEntry | SpanEntry;

const serializeObservabilityEntry = (entry: ObservabilityEntry) => {
	if ("level" in entry) {
		return stableStringify({
			kind: "log",
			level: entry.level,
			message: entry.message,
			...(entry.attributes ? { attributes: entry.attributes } : {}),
		});
	}

	return stableStringify({
		kind: "span",
		name: entry.name,
		...(entry.attributes ? { attributes: entry.attributes } : {}),
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
	driverName: input.driverName,
	executionId: input.executionId,
});

const emitLog = (input: SandboxRunInput, entry: LogEntry) => {
	const effect = Match.value(entry.level).pipe(
		Match.when("debug", () => Effect.logDebug(entry.message)),
		Match.when("info", () => Effect.logInfo(entry.message)),
		Match.when("error", () => Effect.logError(entry.message)),
		Match.when("warning", () => Effect.logWarning(entry.message)),
		Match.exhaustive,
	);
	return effect.pipe(Effect.annotateLogs({ ...entry.attributes, ...correlationAttributes(input) }));
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
									Effect.withSpan(entry.name, {
										attributes: {
											...entry.attributes,
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
) => [...consoleLogs, ...collector.logs];
