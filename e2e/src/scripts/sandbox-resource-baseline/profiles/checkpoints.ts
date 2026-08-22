import { Schema, Struct } from "effect";

import { classifySmaps, SmapsClassification, SmapsRollup } from "./smaps";

const Bytes = Schema.Finite;

/** Bun checkpoint names are operator-chosen, so they are restricted to a label that is safe to commit. */
const CheckpointLabel = Schema.String.pipe(
	Schema.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/)),
);

export const DenoCheckpointRecord = Schema.Struct({
	pid: Schema.Int,
	attempt: Schema.Int,
	sequence: Schema.Int,
	timestampMs: Schema.Finite,
	checkpoint: CheckpointLabel,
	smapsRollup: Schema.NullOr(SmapsRollup),
	heapSnapshotFile: Schema.NullOr(Schema.String),
	denoMemory: Schema.NullOr(
		Schema.Struct({ rss: Bytes, heapUsed: Bytes, external: Bytes, heapTotal: Bytes }),
	),
});
export type DenoCheckpointRecord = typeof DenoCheckpointRecord.Type;

export const BunCheckpointRecord = Schema.Struct({
	sequence: Schema.Int,
	timestampMs: Schema.Finite,
	checkpoint: CheckpointLabel,
	smapsRollup: Schema.NullOr(SmapsRollup),
	activeWorkflows: Schema.NullOr(Schema.Int),
	cgroupMemoryCurrentBytes: Schema.NullOr(Bytes),
	heapSnapshotFile: Schema.NullOr(Schema.String),
	processMemory: Schema.Struct({
		rss: Bytes,
		heapUsed: Bytes,
		external: Bytes,
		heapTotal: Bytes,
		arrayBuffers: Bytes,
	}),
	jscHeap: Schema.Struct({
		heapSize: Bytes,
		heapCapacity: Bytes,
		extraMemorySize: Bytes,
		objectCount: Schema.Int,
		globalObjectCount: Schema.Int,
		protectedObjectCount: Schema.Int,
		topObjectTypes: Schema.Array(Schema.Struct({ count: Schema.Int, type: Schema.String })),
	}),
});
export type BunCheckpointRecord = typeof BunCheckpointRecord.Type;

export const CheckpointRecord = Schema.Union([DenoCheckpointRecord, BunCheckpointRecord]);
export type CheckpointRecord = typeof CheckpointRecord.Type;

/** The backend appends one line per `captureBackendProfile` call to `bun-checkpoints.jsonl`. */
const BackendCheckpointLine = Schema.Struct({
	action: Schema.String,
	label: CheckpointLabel,
	timestampMs: Schema.Finite,
	file: Schema.NullOr(Schema.String),
	jscHeap: BunCheckpointRecord.fields.jscHeap,
	smapsRollup: BunCheckpointRecord.fields.smapsRollup,
	processMemory: BunCheckpointRecord.fields.processMemory,
	activeWorkflows: BunCheckpointRecord.fields.activeWorkflows,
	cgroupMemoryCurrentBytes: BunCheckpointRecord.fields.cgroupMemoryCurrentBytes,
});

const decodeDenoRecord = Schema.decodeUnknownSync(Schema.fromJsonString(DenoCheckpointRecord));
const decodeBackendLine = Schema.decodeUnknownSync(Schema.fromJsonString(BackendCheckpointLine));

const lines = (text: string) => text.split("\n").filter((line) => line.trim() !== "");

export const decodeCheckpointJsonl = (text: string): ReadonlyArray<CheckpointRecord> =>
	lines(text).map((line) => decodeDenoRecord(line));

export const decodeBackendCheckpointJsonl = (text: string): ReadonlyArray<CheckpointRecord> =>
	lines(text).map((line, index) => {
		const { file, label, action, ...record } = decodeBackendLine(line);
		return Object.assign(record, {
			checkpoint: label,
			sequence: index + 1,
			heapSnapshotFile: action === "heap-snapshot" ? file : null,
		});
	});

const NullableNumber = Schema.NullOr(Schema.Finite);

export const CheckpointMetrics = Schema.Struct({
	...SmapsClassification.fields,
	rssBytes: NullableNumber,
	pssBytes: NullableNumber,
	heapUsedBytes: NullableNumber,
	externalBytes: NullableNumber,
	heapTotalBytes: NullableNumber,
	jscObjectCount: NullableNumber,
	activeWorkflows: NullableNumber,
	arrayBuffersBytes: NullableNumber,
	cgroupMemoryBytes: NullableNumber,
});
export type CheckpointMetrics = typeof CheckpointMetrics.Type;

const LargestIncrease = Schema.NullOr(
	Schema.Struct({
		sequence: Schema.Int,
		checkpoint: Schema.String,
		deltaBytes: Schema.Finite,
		phase: Schema.NullOr(Schema.String),
	}),
);

export const CheckpointSeriesSummary = Schema.Struct({
	/** The step between consecutive checkpoints with the largest RSS change. */
	largestRssDelta: LargestIncrease,
	largestHeapUsedDelta: LargestIncrease,
	runtime: Schema.Literals(["deno", "bun"]),
	checkpoints: Schema.Array(
		Schema.Struct({
			sequence: Schema.Int,
			elapsedMs: Schema.Finite,
			checkpoint: Schema.String,
			values: CheckpointMetrics,
			hasHeapSnapshot: Schema.Boolean,
			deltaFromFirst: CheckpointMetrics,
			attempt: Schema.NullOr(Schema.Int),
			phase: Schema.NullOr(Schema.String),
			deltaFromPrevious: Schema.NullOr(CheckpointMetrics),
		}),
	),
});
export type CheckpointSeriesSummary = typeof CheckpointSeriesSummary.Type;

const isDenoRecord = (record: CheckpointRecord): record is DenoCheckpointRecord =>
	"denoMemory" in record;

const smapsMetrics = (rollup: SmapsRollup | null) => ({
	...(rollup === null
		? { shmemBytes: null, sharedBytes: null, fileBackedBytes: null, privateAnonymousBytes: null }
		: classifySmaps(rollup)),
	pssBytes: rollup?.pssBytes ?? null,
});

const metricsOf = (record: CheckpointRecord): CheckpointMetrics => {
	if (isDenoRecord(record)) {
		return {
			...smapsMetrics(record.smapsRollup),
			jscObjectCount: null,
			activeWorkflows: null,
			arrayBuffersBytes: null,
			cgroupMemoryBytes: null,
			heapUsedBytes: record.denoMemory?.heapUsed ?? null,
			externalBytes: record.denoMemory?.external ?? null,
			heapTotalBytes: record.denoMemory?.heapTotal ?? null,
			rssBytes: record.denoMemory?.rss ?? record.smapsRollup?.rssBytes ?? null,
		};
	}
	return {
		...smapsMetrics(record.smapsRollup),
		rssBytes: record.processMemory.rss,
		activeWorkflows: record.activeWorkflows,
		jscObjectCount: record.jscHeap.objectCount,
		heapUsedBytes: record.processMemory.heapUsed,
		externalBytes: record.processMemory.external,
		heapTotalBytes: record.processMemory.heapTotal,
		cgroupMemoryBytes: record.cgroupMemoryCurrentBytes,
		arrayBuffersBytes: record.processMemory.arrayBuffers,
	};
};

const metricKeys = Struct.keys(CheckpointMetrics.fields);

const difference = (current: CheckpointMetrics, base: CheckpointMetrics): CheckpointMetrics => {
	const delta: Record<keyof CheckpointMetrics, number | null> = { ...current };
	for (const key of metricKeys) {
		const [now, then] = [current[key], base[key]];
		delta[key] = now === null || then === null ? null : now - then;
	}
	return delta;
};

/**
 * The first dependency operation of a YouTube Music execution creates the provider client, and the
 * last host call before the result is built returns the provider response.
 */
const denoPhases = (records: ReadonlyArray<CheckpointRecord>) => {
	const resultIndex = records.findIndex(({ checkpoint }) => checkpoint === "result-built");
	const beforeResult = resultIndex === -1 ? records : records.slice(0, resultIndex);
	const clientIndex = records.findIndex(({ checkpoint }) => checkpoint === "dependency-settled");
	const responseIndex = beforeResult.findLastIndex(
		({ checkpoint }) => checkpoint === "host-call-settled",
	);
	return records.map((_record, index) => {
		if (index === clientIndex) {
			return "provider-client-created";
		}
		if (index === responseIndex) {
			return "provider-response-received";
		}
		return null;
	});
};

export const summarizeCheckpointSeries = (
	unordered: ReadonlyArray<CheckpointRecord>,
): CheckpointSeriesSummary => {
	const records = [...unordered].sort((left, right) => left.sequence - right.sequence);
	const deno = records.every(isDenoRecord);
	if (!deno && records.some(isDenoRecord)) {
		throw new Error("a checkpoint series mixes Deno and Bun records");
	}
	const phases = deno ? denoPhases(records) : records.map(() => null);
	const metrics = records.map(metricsOf);
	const first = metrics[0];
	const checkpoints = records.map((record, index) => {
		const values = metrics[index] ?? metricsOf(record);
		const previous = metrics[index - 1];
		return {
			values,
			sequence: record.sequence,
			phase: phases[index] ?? null,
			checkpoint: record.checkpoint,
			hasHeapSnapshot: record.heapSnapshotFile !== null,
			deltaFromFirst: difference(values, first ?? values),
			attempt: isDenoRecord(record) ? record.attempt : null,
			elapsedMs: record.timestampMs - (records[0]?.timestampMs ?? record.timestampMs),
			deltaFromPrevious: previous === undefined ? null : difference(values, previous),
		};
	});
	const largest = (key: "rssBytes" | "heapUsedBytes") =>
		checkpoints.reduce<CheckpointSeriesSummary["largestRssDelta"]>((best, entry) => {
			const delta = entry.deltaFromPrevious?.[key] ?? null;
			if (delta === null || (best !== null && best.deltaBytes >= delta)) {
				return best;
			}
			const { phase, sequence, checkpoint } = entry;
			return { phase, sequence, checkpoint, deltaBytes: delta };
		}, null);
	return {
		checkpoints,
		runtime: deno ? "deno" : "bun",
		largestRssDelta: largest("rssBytes"),
		largestHeapUsedDelta: largest("heapUsedBytes"),
	};
};
