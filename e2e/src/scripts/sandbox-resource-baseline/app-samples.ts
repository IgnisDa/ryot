import {
	TestSupportOperationalPressure,
	TestSupportSandboxRuntimeMetrics,
} from "@ryot-app/contract/modules/test-support/schemas";
import { Exit, Schema } from "effect";

import { CadenceRecord } from "./cadence";
import type { AppRecord, CompletedWorkerRecord, HealthPing, PressurePoint } from "./statistics";

export type RuntimeSample = typeof TestSupportSandboxRuntimeMetrics.Type;

export const AppSampleLine = Schema.Struct({
	...CadenceRecord.fields,
	timestampMs: Schema.Finite,
	status: Schema.NullOr(Schema.Int),
	kind: Schema.Literal("app-sample"),
	error: Schema.NullOr(Schema.String),
	sample: Schema.NullOr(TestSupportSandboxRuntimeMetrics),
});
export type AppSampleLine = typeof AppSampleLine.Type;

export const AppAuxLine = Schema.Struct({
	startedMs: Schema.Finite,
	timestampMs: Schema.Finite,
	kind: Schema.Literal("app-aux"),
	pressure: Schema.NullOr(TestSupportOperationalPressure),
	health: Schema.NullOr(
		Schema.Struct({
			ok: Schema.Boolean,
			latencyMs: Schema.Finite,
			status: Schema.NullOr(Schema.Int),
		}),
	),
});
export type AppAuxLine = typeof AppAuxLine.Type;

const decodeLine = Schema.decodeUnknownExit(
	Schema.fromJsonString(Schema.Union([AppSampleLine, AppAuxLine])),
);

export const decodeAppLines = (contents: string) => {
	const samples: AppSampleLine[] = [];
	const aux: AppAuxLine[] = [];
	let undecodable = 0;
	for (const line of contents.split("\n")) {
		if (line.trim() === "") {
			continue;
		}
		const exit = decodeLine(line);
		if (Exit.isFailure(exit)) {
			undecodable += 1;
		} else if (exit.value.kind === "app-sample") {
			samples.push(exit.value);
		} else {
			aux.push(exit.value);
		}
	}
	return { aux, samples, undecodable };
};

export const appRecord = (sample: RuntimeSample, t = sample.timestampMs): AppRecord => ({
	t,
	denoRss: sample.deno.rssBytes,
	bunRss: sample.backend.rssBytes,
	bunHwm: sample.backend.hwmBytes,
	totalSpawned: sample.totalSpawned,
	totalCompleted: sample.totalCompleted,
	executionsTotal: sample.executions.total,
	bunExternal: sample.backend.externalBytes,
	bunHeapUsed: sample.backend.heapUsedBytes,
	replaysFailed: sample.replays.totalFailed,
	activeExecutions: sample.executions.active,
	bunHeapTotal: sample.backend.heapTotalBytes,
	replaysStarted: sample.replays.totalStarted,
	bunUserMicros: sample.backend.userCpuMicros,
	bunSystemMicros: sample.backend.systemCpuMicros,
	replaysCompleted: sample.replays.totalCompleted,
	bunArrayBuffers: sample.backend.arrayBuffersBytes,
	cgroupPeak: sample.cgroup?.memoryPeakBytes ?? null,
	cgroupOomKill: sample.cgroup?.events.oomKill ?? null,
	replayJournalBytes: sample.replays.totalJournalBytes,
	durableRequests: sample.replays.totalDurableRequests,
	cgroupCurrent: sample.cgroup?.memoryCurrentBytes ?? null,
	executingImportBodies: sample.providerImports.executingBodies,
	workers: sample.workers.map(({ pid, rssBytes }) => ({ pid, rss: rssBytes })),
});

/** Worker records arrive incrementally through the collector cursor, so they are de-duplicated. */
export const completedWorkers = (
	samples: ReadonlyArray<AppSampleLine>,
): CompletedWorkerRecord[] => {
	const bySequence = new Map<number, CompletedWorkerRecord>();
	for (const line of samples) {
		for (const worker of line.sample?.completedWorkers ?? []) {
			bySequence.set(worker.sequence, worker);
		}
	}
	return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
};

export const healthPings = (aux: ReadonlyArray<AppAuxLine>): HealthPing[] =>
	aux.flatMap(({ health, startedMs }) =>
		health === null ? [] : [{ t: startedMs, ok: health.ok, latencyMs: health.latencyMs }],
	);

export const pressurePoints = (aux: ReadonlyArray<AppAuxLine>): PressurePoint[] =>
	aux.flatMap(({ pressure, startedMs }) =>
		pressure === null
			? []
			: [
					{
						t: startedMs,
						deadlocks: pressure.database.deadlocks,
						totalConnections: pressure.database.totalConnections,
						activeConnections: pressure.database.activeConnections,
						lockWaitingConnections: pressure.database.lockWaitingConnections,
					},
				],
	);
