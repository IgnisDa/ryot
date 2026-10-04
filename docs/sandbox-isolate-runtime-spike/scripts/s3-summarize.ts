import { existsSync, readFileSync, writeFileSync } from "node:fs";

import {
	decodeExitCodes,
	decodeFairness,
	decodeLatencyTrial,
	ENDPOINTS,
	type FairnessRecord,
	type LatencySample,
	type LatencyTrialRecord,
	type MetricSnapshot,
	percentile,
} from "../../../e2e/s3-benchmark-records";

const D4_RATIO = 1.1;
const INVARIANT_KEYS = [
	"SERVER_LOG_LEVEL",
	"DATABASE_POOL_MAX",
	"SANDBOX_WORKER_CONCURRENCY",
	"SANDBOX_MEMORY_BUDGET_MIB",
	"cpuIterations",
	"platform",
] as const;

type Endpoint = (typeof ENDPOINTS)[number];
type Mode = LatencyTrialRecord["mode"];
type Options = { measured: number; pairs: number; resolutionShare: number; warmup: number };

const defaults: Options = { pairs: 6, warmup: 20, measured: 200, resolutionShare: 0.1 };

const mean = (values: ReadonlyArray<number>) =>
	values.length === 0 ? Number.NaN : values.reduce((sum, value) => sum + value, 0) / values.length;

const round = (value: number, digits = 1) => {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
};

const stats = (values: ReadonlyArray<number>) => ({
	count: values.length,
	p50: percentile(values, 50),
	p95: percentile(values, 95),
});

const durations = (samples: ReadonlyArray<LatencySample>) =>
	samples.map(({ durationMs }) => durationMs);

type Histogram = {
	bounds: ReadonlyArray<number>;
	buckets: Array<number>;
	count: number;
	sum: number;
};

const emptyHistogram = (): Histogram => ({ sum: 0, count: 0, bounds: [], buckets: [] });

const accumulate = (into: Histogram, source: Histogram) => {
	into.sum += source.sum;
	into.count += source.count;
	into.bounds = source.bounds;
	for (const [index, value] of source.buckets.entries()) {
		into.buckets[index] = (into.buckets[index] ?? 0) + value;
	}
};

// Upper-bound estimate: the bound of the bucket containing the nearest-rank sample.
const histogramQuantile = (histogram: Histogram, p: number) => {
	if (histogram.count === 0) {
		return Number.NaN;
	}
	const rank = Math.max(1, Math.ceil((p / 100) * histogram.count));
	let seen = 0;
	for (const [index, bucket] of histogram.buckets.entries()) {
		seen += bucket;
		if (seen >= rank) {
			return histogram.bounds[index] ?? Number.POSITIVE_INFINITY;
		}
	}
	return Number.POSITIVE_INFINITY;
};

const attributeKey = (attributes: Record<string, string>) =>
	JSON.stringify(Object.entries(attributes).sort(([left], [right]) => left.localeCompare(right)));

type SeriesWindow = { attributes: Record<string, string>; histogram?: Histogram; value: number };

// Cumulative series: the window is the last snapshot minus the first (zero when none precedes it).
const metricDelta = (snapshots: ReadonlyArray<MetricSnapshot>, name: string) => {
	const first = snapshots[0]?.metrics[name] ?? [];
	const last = snapshots.at(-1)?.metrics[name] ?? [];
	const firstByKey = new Map(
		first.map((point) => [attributeKey(point.attributes), point] as const),
	);
	return last.map((point): SeriesWindow => {
		const before = firstByKey.get(attributeKey(point.attributes));
		const isHistogram = point.count !== null;
		return {
			attributes: point.attributes,
			value: (point.value ?? 0) - (before?.value ?? 0),
			histogram: isHistogram
				? {
						bounds: point.bounds,
						sum: (point.sum ?? 0) - (before?.sum ?? 0),
						count: (point.count ?? 0) - (before?.count ?? 0),
						buckets: point.buckets.map((bucket, index) => bucket - (before?.buckets[index] ?? 0)),
					}
				: undefined,
		};
	});
};

const maxGauge = (snapshots: ReadonlyArray<MetricSnapshot>, name: string) => {
	const values = snapshots.flatMap(({ metrics }) =>
		(metrics[name] ?? []).flatMap(({ value }) => (value === null ? [] : [value])),
	);
	return values.length === 0 ? null : Math.max(...values);
};

const mergeWindows = (
	windows: ReadonlyArray<ReadonlyArray<SeriesWindow>>,
	match: (attributes: Record<string, string>) => boolean,
) => {
	const histogram = emptyHistogram();
	let value = 0;
	for (const series of windows) {
		for (const point of series) {
			if (!match(point.attributes)) {
				continue;
			}
			value += point.value;
			if (point.histogram) {
				accumulate(histogram, point.histogram);
			}
		}
	}
	return { value, histogram };
};

const histogramSummary = (histogram: Histogram) => ({
	count: histogram.count,
	meanMs: histogram.count === 0 ? null : histogram.sum / histogram.count,
	p95UpperBoundMs: histogram.count === 0 ? null : histogramQuantile(histogram, 95),
});

const pooledMetric = (
	records: ReadonlyArray<{ metrics: ReadonlyArray<MetricSnapshot> }>,
	name: string,
) => records.map((record) => metricDelta(record.metrics, name));

const byLane = (windows: ReadonlyArray<ReadonlyArray<SeriesWindow>>) =>
	Object.fromEntries(
		["interactive", "background"].map((lane) => {
			const merged = mergeWindows(windows, ({ lane: attributeLane }) => attributeLane === lane);
			return [
				lane,
				{ count: merged.value, histogram: histogramSummary(merged.histogram) },
			] as const;
		}),
	);

const ticketOutcomes = (windows: ReadonlyArray<ReadonlyArray<SeriesWindow>>) =>
	Object.fromEntries(
		["interactive", "background"].map((lane) => [
			lane,
			Object.fromEntries(
				["granted", "expired", "overloaded"].map((outcome) => [
					outcome,
					mergeWindows(
						windows,
						(attributes) => attributes.lane === lane && attributes.outcome === outcome,
					).value,
				]),
			),
		]),
	);

const metricsReport = (records: ReadonlyArray<LatencyTrialRecord | FairnessRecord>) => {
	const window = (name: string) => pooledMetric(records, name);
	const sum = (name: string, match: (attributes: Record<string, string>) => boolean = () => true) =>
		mergeWindows(window(name), match).value;
	const peaks = (name: string) =>
		Math.max(0, ...records.map(({ metrics }) => maxGauge(metrics, name) ?? 0));
	return {
		queueWait: byLane(window("ryot.durable_queue.wait_duration")),
		laneDispatches: byLane(window("ryot.durable_queue.dispatches")),
		cpuSlotWait: byLane(window("ryot.sandbox.execution.cpu_wait")),
		httpTicketWait: byLane(window("ryot.http_admission.ticket_wait")),
		httpTickets: ticketOutcomes(window("ryot.http_admission.tickets")),
		memoryAdmissionWait: histogramSummary(
			mergeWindows(window("ryot.sandbox.admission.wait_duration"), () => true).histogram,
		),
		replayCount: sum("ryot.sandbox.workflow_replays"),
		hostCalls: sum("ryot.sandbox.host_calls"),
		executions: sum("ryot.sandbox.executions"),
		peakAdmissionWaiting: peaks("ryot.sandbox.admission.waiting"),
		peakAdmissionBytes: peaks("ryot.sandbox.admission.bytes"),
		peakAdmissionPressure: peaks("ryot.sandbox.admission.pressure"),
		peakBackendRssBytes: peaks("ryot.backend.rss"),
		peakSidecarRssBytes: peaks("ryot.sandbox.sidecar.rss"),
		peakWorkerRssBytes: peaks("ryot.sandbox.worker_rss"),
	};
};

const hostReport = (records: ReadonlyArray<LatencyTrialRecord | FairnessRecord>) => {
	const samples = records.flatMap(({ host }) => host);
	const busy = samples.flatMap(({ cpuBusy }) => (cpuBusy === null ? [] : [cpuBusy]));
	return {
		samples: samples.length,
		meanCpuBusy: busy.length === 0 ? null : mean(busy),
		peakServerTreeRssMiB: Math.max(0, ...samples.map(({ serverTreeRssMiB }) => serverTreeRssMiB)),
		meanActiveConnections: mean(samples.map(({ activeConnections }) => activeConnections)),
		peakTotalConnections: Math.max(0, ...samples.map(({ totalConnections }) => totalConnections)),
		peakLockWaitingConnections: Math.max(
			0,
			...samples.map(({ lockWaitingConnections }) => lockWaitingConnections),
		),
		peakActiveExecutions: Math.max(0, ...samples.map(({ activeExecutions }) => activeExecutions)),
	};
};

const admissionMs = ({ ticketWaitMs, resumeDelayMs }: LatencySample) =>
	(ticketWaitMs ?? 0) + (resumeDelayMs ?? 0);

// The tail is every sample at or above the pooled p95 total time; its mean total and mean
// HTTP-admission time (ticket wait + resume delay, from per-sample server log values) are compared.
const tailAdmission = (samples: ReadonlyArray<LatencySample>) => {
	const threshold = percentile(durations(samples), 95);
	const tail = samples.filter(({ durationMs }) => durationMs >= threshold);
	return {
		tailCount: tail.length,
		tailMeanMs: mean(tail.map(({ durationMs }) => durationMs)),
		admissionP50Ms: percentile(samples.map(admissionMs), 50),
		admissionP95Ms: percentile(samples.map(admissionMs), 95),
		tailMeanAdmissionMs: mean(tail.map(admissionMs)),
		meanAdmissionMs: mean(samples.map(admissionMs)),
	};
};

type Pooled = Record<Mode, Record<Endpoint, ReadonlyArray<LatencySample>>>;

const decomposition = (pooled: Pooled) =>
	Object.fromEntries(
		ENDPOINTS.map((endpoint) => {
			const deltaP95 =
				percentile(durations(pooled.loaded[endpoint]), 95) -
				percentile(durations(pooled.unloaded[endpoint]), 95);
			const unloaded = tailAdmission(pooled.unloaded[endpoint]);
			const loaded = tailAdmission(pooled.loaded[endpoint]);
			const admissionPartMs = loaded.tailMeanAdmissionMs - unloaded.tailMeanAdmissionMs;
			return [
				endpoint,
				{
					deltaP95Ms: deltaP95,
					admissionPartMs,
					remainderMs: deltaP95 - admissionPartMs,
					unloaded,
					loaded,
				},
			] as const;
		}),
	);

const readIfPresent = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : undefined);

const decodeFile = <A>(
	errors: Array<string>,
	label: string,
	path: string,
	decode: (text: string) => A,
) => {
	const text = readIfPresent(path);
	if (text === undefined) {
		errors.push(`${label}: missing record ${path}`);
		return undefined;
	}
	try {
		return decode(text);
	} catch (error) {
		errors.push(`${label}: record does not match the schema (${String(error).split("\n")[0]})`);
		return undefined;
	}
};

const equalJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export const summarize = (directory: string, overrides: Partial<Options> = {}) => {
	const options = { ...defaults, ...overrides };
	const errors: Array<string> = [];
	const trials: Array<LatencyTrialRecord> = [];

	const exitText = readIfPresent(`${directory}/exit-codes.json`);
	if (exitText === undefined) {
		errors.push("exit-codes.json is missing");
	} else {
		const exitCodes = decodeExitCodes(exitText);
		const expected = [
			...Array.from({ length: options.pairs }, (_, index) => [
				`unloaded-${index + 1}`,
				`loaded-${index + 1}`,
			]).flat(),
			"fairness",
		];
		for (const step of expected) {
			if (exitCodes[step] === undefined) {
				errors.push(`exit code for step ${step} is missing`);
			}
		}
		for (const [step, code] of Object.entries(exitCodes)) {
			if (code !== 0) {
				errors.push(`step ${step} exited with ${code}`);
			}
		}
	}

	for (let pair = 1; pair <= options.pairs; pair += 1) {
		for (const mode of ["unloaded", "loaded"] as const) {
			const label = `${mode}-${pair}`;
			const trial = decodeFile(errors, label, `${directory}/${label}.json`, decodeLatencyTrial);
			if (trial === undefined) {
				continue;
			}
			trials.push(trial);
			if (trial.mode !== mode || trial.pair !== pair) {
				errors.push(`${label}: record claims mode ${trial.mode} pair ${trial.pair}`);
			}
			if (trial.warmup.search !== options.warmup || trial.warmup.details !== options.warmup) {
				errors.push(`${label}: expected ${options.warmup} warm-up requests per endpoint`);
			}
			for (const endpoint of ENDPOINTS) {
				const samples = trial.samples[endpoint];
				if (samples.length < options.measured) {
					errors.push(
						`${label}: ${endpoint} has ${samples.length} measured samples, expected at least ${options.measured}`,
					);
				}
				const unattributed = samples.filter(
					({ ticketWaitMs, resumeDelayMs, durationMs }) =>
						ticketWaitMs === null ||
						resumeDelayMs === null ||
						ticketWaitMs + resumeDelayMs > durationMs,
				).length;
				if (unattributed > 0) {
					errors.push(
						`${label}: ${endpoint} has ${unattributed} samples without a valid ticket wait and resume delay`,
					);
				}
				if (new Set(samples.map(({ input }) => input)).size !== samples.length) {
					errors.push(`${label}: ${endpoint} inputs are not distinct`);
				}
				if (samples.some(({ durationMs }) => durationMs <= 0)) {
					errors.push(`${label}: ${endpoint} has a non-positive duration`);
				}
			}
			if (trial.metrics.length < 2) {
				errors.push(`${label}: the OTel metrics window has fewer than two snapshots`);
			}
			if (trial.host.length === 0) {
				errors.push(`${label}: no host samples`);
			}
			if (mode === "loaded") {
				if (!trial.saturation.proven || trial.saturation.reachedAtMs === null) {
					errors.push(`${label}: CPU saturation was not proven`);
				}
				if ((trial.saturation.measurementBusy ?? 0) < trial.saturation.threshold) {
					errors.push(
						`${label}: mean CPU busy ${trial.saturation.measurementBusy} is below ${trial.saturation.threshold}`,
					);
				}
				if (!trial.background.continuous || trial.background.gatesFailed > 0) {
					errors.push(`${label}: background progress was not continuous or a gate failed`);
				}
				if (trial.background.progress.length === 0 || trial.background.gatesStarted === 0) {
					errors.push(`${label}: no background import progress recorded`);
				}
			} else if (trial.background.gatesStarted !== 0) {
				errors.push(`${label}: unloaded trial started background imports`);
			}
		}
	}

	const fairness = decodeFile(errors, "fairness", `${directory}/fairness.json`, decodeFairness);
	const reference = trials[0];
	for (const trial of trials) {
		if (reference === undefined) {
			break;
		}
		if (!equalJson(trial.hashes, reference.hashes)) {
			errors.push(
				`${trial.mode}-${trial.pair}: source or input hashes differ from the first trial`,
			);
		}
		if (!equalJson(trial.configuration, reference.configuration)) {
			errors.push(`${trial.mode}-${trial.pair}: configuration differs from the first trial`);
		}
		if (trial.resolutionMs !== reference.resolutionMs) {
			errors.push(`${trial.mode}-${trial.pair}: timing resolution differs from the first trial`);
		}
	}
	if (fairness !== undefined) {
		if (
			fairness.users.length !== 2 ||
			fairness.users.some(({ completedInWindow }) => completedInWindow === 0)
		) {
			errors.push("fairness: both users must complete work in the window");
		}
		if (fairness.users.some(({ failed }) => failed > 0)) {
			errors.push("fairness: executions failed");
		}
		if (reference !== undefined) {
			for (const key of INVARIANT_KEYS) {
				if (!equalJson(fairness.configuration[key], reference.configuration[key])) {
					errors.push(`fairness: configuration ${key} differs from the latency trials`);
				}
			}
			if (
				fairness.hashes.sources["fairness.script"] !== reference.hashes.sources["fairness.script"]
			) {
				errors.push("fairness: fairness script hash differs from the latency trials");
			}
		}
	}

	const samplesFor = (mode: Mode) => ({
		search: trials.filter((trial) => trial.mode === mode).flatMap((trial) => trial.samples.search),
		details: trials.filter((trial) => trial.mode === mode).flatMap((trial) => trial.samples.details),
	});
	const pooled: Pooled = { loaded: samplesFor("loaded"), unloaded: samplesFor("unloaded") };

	const unloadedDetailsP50 = percentile(durations(pooled.unloaded.details), 50);
	const resolutionMs = reference?.resolutionMs ?? Number.NaN;
	if (!(resolutionMs <= options.resolutionShare * unloadedDetailsP50)) {
		errors.push(
			`timing resolution ${resolutionMs} ms exceeds ${options.resolutionShare * 100}% of the unloaded details p50 (${round(unloadedDetailsP50)} ms)`,
		);
	}

	const endpointReport = Object.fromEntries(
		ENDPOINTS.map((endpoint) => {
			const unloaded = stats(durations(pooled.unloaded[endpoint]));
			const loaded = stats(durations(pooled.loaded[endpoint]));
			const ratio = loaded.p95 / unloaded.p95;
			return [
				endpoint,
				{ unloaded, loaded, ratioP95: ratio, limit: D4_RATIO, passes: ratio <= D4_RATIO },
			] as const;
		}),
	);

	const perPair = trials.map((trial) => ({
		mode: trial.mode,
		pair: trial.pair,
		search: stats(durations(trial.samples.search)),
		details: stats(durations(trial.samples.details)),
		saturation: trial.saturation,
		background: {
			...trial.background,
			progress: undefined,
			progressSamples: trial.background.progress.length,
		},
	}));

	const d4Pass = ENDPOINTS.every((endpoint) => endpointReport[endpoint]?.passes === true);
	const fairnessPass = fairness?.result.pass === true;
	const valid = errors.length === 0;
	let verdict: "fail" | "invalid" | "pass" = "invalid";
	if (valid) {
		verdict = d4Pass && fairnessPass ? "pass" : "fail";
	}

	const loadedTrials = trials.filter((trial) => trial.mode === "loaded");
	const unloadedTrials = trials.filter((trial) => trial.mode === "unloaded");
	const summary = {
		verdict,
		errors,
		options,
		d4: { ratio: D4_RATIO, pass: d4Pass, endpoints: endpointReport },
		percentileDefinition: "nearest-rank",
		perPair,
		fairness: fairness && {
			...fairness,
			host: undefined,
			metrics: undefined,
			users: fairness.users.map((user) => ({ ...user, progress: undefined })),
		},
		decomposition: decomposition(pooled),
		resolution: { resolutionMs, unloadedDetailsP50, share: resolutionMs / unloadedDetailsP50 },
		saturation: loadedTrials.map(({ pair, saturation }) => ({ pair, ...saturation })),
		metrics: {
			loaded: metricsReport(loadedTrials),
			unloaded: metricsReport(unloadedTrials),
			fairness: fairness === undefined ? undefined : metricsReport([fairness]),
		},
		host: {
			loaded: hostReport(loadedTrials),
			unloaded: hostReport(unloadedTrials),
			fairness: fairness === undefined ? undefined : hostReport([fairness]),
		},
		hostFacts: readIfPresent(`${directory}/host-facts.json`) ?? null,
	};
	return summary;
};

type Summary = ReturnType<typeof summarize>;

const cell = (value: number | null | undefined) =>
	value === null || value === undefined || Number.isNaN(value) ? "n/a" : String(round(value));

const renderMarkdown = (summary: Summary) => {
	const lines: Array<string> = [
		`# S3 benchmark summary`,
		"",
		`Verdict: **${summary.verdict}**`,
		"",
	];
	if (summary.errors.length > 0) {
		lines.push("## Validation errors", "", ...summary.errors.map((error) => `- ${error}`), "");
	}
	lines.push(
		"## D4 (pooled p95, loaded versus unloaded)",
		"",
		"| Endpoint | Unloaded n | Unloaded p50 ms | Unloaded p95 ms | Loaded n | Loaded p50 ms | Loaded p95 ms | Ratio | Limit | Result |",
		"| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
	);
	for (const endpoint of ENDPOINTS) {
		const report = summary.d4.endpoints[endpoint];
		if (report === undefined) {
			continue;
		}
		lines.push(
			`| ${endpoint} | ${report.unloaded.count} | ${cell(report.unloaded.p50)} | ${cell(report.unloaded.p95)} | ${report.loaded.count} | ${cell(report.loaded.p50)} | ${cell(report.loaded.p95)} | ${round(report.ratioP95, 3)} | ${report.limit} | ${report.passes ? "pass" : "fail"} |`,
		);
	}
	lines.push(
		"",
		"## Per pair",
		"",
		"| Pair | Mode | Search n | Search p50 | Search p95 | Details n | Details p50 | Details p95 | CPU busy | Gates done |",
		"| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
		...summary.perPair.map(
			(trial) =>
				`| ${trial.pair} | ${trial.mode} | ${trial.search.count} | ${cell(trial.search.p50)} | ${cell(trial.search.p95)} | ${trial.details.count} | ${cell(trial.details.p50)} | ${cell(trial.details.p95)} | ${cell(trial.saturation.measurementBusy === null ? null : trial.saturation.measurementBusy * 100)}% | ${trial.background.gatesCompleted} |`,
		),
		"",
		"## Loaded minus unloaded p95 delta",
		"",
		"| Endpoint | Delta p95 ms | HTTP admission part (ticket wait + resume delay, tail-mean delta) | Remainder | Unloaded tail admission ms | Loaded tail admission ms |",
		"| --- | --- | --- | --- | --- | --- |",
		...ENDPOINTS.map((endpoint) => {
			const part = summary.decomposition[endpoint];
			return `| ${endpoint} | ${cell(part?.deltaP95Ms)} | ${cell(part?.admissionPartMs)} | ${cell(part?.remainderMs)} | ${cell(part?.unloaded.tailMeanAdmissionMs)} | ${cell(part?.loaded.tailMeanAdmissionMs)} |`;
		}),
		"",
		`Timing resolution ${summary.resolution.resolutionMs} ms (${round(summary.resolution.share * 100, 2)}% of the unloaded details p50).`,
		"",
	);
	if (summary.fairness !== undefined) {
		lines.push(
			"## Fairness",
			"",
			`Pass: ${summary.fairness.result.pass}; completed executions differ by ${summary.fairness.result.executionDifference} (tolerance ${summary.fairness.tolerance.executions}); HTTP admissions differ by ${summary.fairness.result.admissionDifference} (tolerance ${summary.fairness.tolerance.admissions}).`,
			"",
			"| User | Plugins | Completed in window | Admissions in window | Failed | Latency p50 ms | Latency p95 ms |",
			"| --- | --- | --- | --- | --- | --- | --- |",
			...summary.fairness.users.map(
				(user) =>
					`| ${user.label} | ${user.plugins} | ${user.completedInWindow} | ${user.admissionsInWindow} | ${user.failed} | ${cell(user.latencyP50Ms)} | ${cell(user.latencyP95Ms)} |`,
			),
			"",
		);
	}
	lines.push(
		"## Scheduling metrics (loaded trials, interactive and background lanes)",
		"",
		"```json",
		JSON.stringify(summary.metrics.loaded, null, 2),
		"```",
		"",
	);
	return `${lines.join("\n")}\n`;
};

const parseFlag = (args: ReadonlyArray<string>, flag: string) => {
	const index = args.indexOf(flag);
	return index === -1 ? undefined : Number(args[index + 1]);
};

if (import.meta.main) {
	const args = process.argv.slice(2);
	const directory = args.find((argument) => !argument.startsWith("--") && !/^\d+$/.test(argument));
	if (directory === undefined) {
		console.error(
			"usage: bun s3-summarize.ts <results-dir> [--pairs 6] [--warmup 20] [--measured 200]",
		);
		process.exit(2);
	}
	if (!existsSync(directory)) {
		console.error(`results directory ${directory} does not exist`);
		process.exit(2);
	}
	const summary = summarize(directory, {
		pairs: parseFlag(args, "--pairs") ?? defaults.pairs,
		warmup: parseFlag(args, "--warmup") ?? defaults.warmup,
		measured: parseFlag(args, "--measured") ?? defaults.measured,
	});
	const markdown = renderMarkdown(summary);
	writeFileSync(`${directory}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
	writeFileSync(`${directory}/summary.md`, markdown);
	console.log(markdown);
	process.exit(summary.verdict === "pass" ? 0 : summary.verdict === "fail" ? 1 : 2);
}
