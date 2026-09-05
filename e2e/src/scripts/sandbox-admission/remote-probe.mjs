// Runs inside the benchmark application container with Bun, against the local API, so request
// latency excludes the public route. Usage:
//   bun remote-probe.mjs <state.json> <label> <warmup|single|mixed|slow> <repetitions>
// `state.json` comes from remote-setup.ts. Each repetition starts from a drained runtime and records
// per-import queue wait and execution time, health and search latency, and resource peaks for
// exactly the work it submitted. Output: /tmp/<label>.jsonl.
import { appendFileSync, readFileSync } from "node:fs";

// Probe polling and sampling require ordered awaits; parallel requests would change what is measured.
/* oxlint-disable no-await-in-loop -- Sequential polls and measurements are part of the probe. */

const [statePath, label, scenario, repetitionsText = "1"] = process.argv.slice(2);
if (!statePath || !/^[a-z0-9.-]+$/.test(label ?? "") || !scenario) {
	throw new Error("usage: remote-probe.mjs <state.json> <label> <warmup|single|mixed|slow> <reps>");
}
const state = JSON.parse(readFileSync(statePath, "utf8"));
const repetitions = Number(repetitionsText);
const base = "http://127.0.0.1:8000/api";
const adminHeaders = {
	"Content-Type": "application/json",
	"Admin-Access-Token": process.env.SERVER_ADMIN_ACCESS_TOKEN,
};
const userHeaders = (user) => ({ "X-Api-Key": user.apiKey, "Content-Type": "application/json" });
const IDLE_WINDOW_MS = 3_000;
const SETTLE_MS = Number(process.env.PROBE_SETTLE_MS ?? 60_000);
const SAMPLE_INTERVAL_MS = 250;
const SERIES_INTERVAL_MS = 1_000;
const HEALTH_INTERVAL_MS = 1_000;
const HEALTH_TIMEOUT_MS = 5_000;
const SEARCH_INTERVAL_MS = 10_000;
const RESULT_POLL_MS = 2_000;
const OTHER_USER_DELAY_MS = 30_000;
const SLOW_LEAD_MS = 2_000;
const TIMEOUT_MS = 60 * 60_000;
// Fail fast: a run that makes no sandbox progress, or cannot reach health, never finishes usefully.
const STALL_MS = Number(process.env.PROBE_STALL_MS ?? 180_000);
const UNREACHABLE_MS = 120_000;

const fatal = (message) => {
	console.error(`probe failed: ${label} ${scenario}: ${message}`);
	process.exit(1);
};

const call = async (path, headers, body, method) => {
	const startedAt = performance.now();
	const response = await fetch(`${base}${path}`, {
		headers,
		signal: AbortSignal.timeout(90_000),
		method: method ?? (body === undefined ? "GET" : "POST"),
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	const value = await response.json().catch(() => null);
	return { value, status: response.status, latencyMs: performance.now() - startedAt };
};
const admin = async (path) => {
	const response = await call(`/test-support/${path}`, adminHeaders);
	if (response.status !== 200) {
		throw new Error(`${path}: HTTP ${response.status}`);
	}
	return response.value;
};
// The cursor skips completed-worker records already seen, keeping each 250 ms sample small.
let workerCursor = 0;
// Any new spawn or execution counts as progress. Active work without progress is a stall here;
// pending imports without progress are a stall in `awaitTerminal`.
let progress = { key: null, at: Date.now() };
const sample = async () => {
	const current = await admin(
		`sandbox/runtime?includeSmaps=false&completedAfterSequence=${workerCursor}`,
	);
	workerCursor = Math.max(workerCursor, current.completedWorkerSequence);
	const key = `${current.totalSpawned}:${current.executions.total}`;
	if (key !== progress.key) {
		progress = { key, at: Date.now() };
	} else if (!isIdle(current) && Date.now() - progress.at > STALL_MS) {
		fatal(`no sandbox progress for ${STALL_MS / 1000}s with work active`);
	}
	return current;
};
const phaseSegments = (after) => admin(`provider-imports/phase-segments?afterSequence=${after}`);

const invocation = Date.now().toString(36);
const externalId = (nonce) => ["bm", 71, 10, 10, 5, 1024, 25, "success", nonce].join(".");

const isIdle = (value) =>
	value.executions.active === 0 &&
	value.activeProcessCount === 0 &&
	value.providerImports.executingBodies === 0;

// Drained means idle with no new spawn for a whole window, so detached automations are included.
const waitForDrain = async (observe) => {
	const startedAt = Date.now();
	let idleSince = null;
	let spawned = null;
	for (;;) {
		if (Date.now() - startedAt > TIMEOUT_MS) {
			fatal(`runtime did not drain within ${TIMEOUT_MS / 60_000} minutes`);
		}
		const current = await sample();
		observe(current);
		if (isIdle(current) && current.totalSpawned === spawned) {
			idleSince ??= Date.now();
			if (Date.now() - idleSince >= IDLE_WINDOW_MS) {
				return current;
			}
		} else {
			idleSince = null;
		}
		spawned = current.totalSpawned;
		await Bun.sleep(SAMPLE_INTERVAL_MS);
	}
};

/** Repeats `step` every `intervalMs` until `stopped` resolves; returns the collected results. */
const every = (intervalMs, stopped, step) =>
	(async () => {
		const results = [];
		let done = false;
		stopped.then(() => {
			done = true;
		});
		while (!done) {
			const startedAt = Date.now();
			results.push(await step());
			const wait = Math.max(0, intervalMs - (Date.now() - startedAt));
			await Promise.race([Bun.sleep(wait), stopped]);
		}
		return results;
	})().catch((error) => fatal(`background probe failed: ${error}`));

let healthyAt = Date.now();
const probeHealth = async () => {
	const startedAt = performance.now();
	const ok = await fetch(`${base}/system/health`, {
		signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
	})
		.then((response) => response.ok)
		.catch(() => false);
	if (ok) {
		healthyAt = Date.now();
	} else if (Date.now() - healthyAt > UNREACHABLE_MS) {
		fatal(`health has failed for ${UNREACHABLE_MS / 1000}s`);
	}
	return { ok, latencyMs: performance.now() - startedAt };
};

const probeSearch = async () => {
	const response = await call("/provider-entities/search", userHeaders(state.other), {
		page: 1,
		pageSize: 10,
		query: "admission",
		providerId: state.other.bookProviderId,
	});
	return { ok: response.status === 200, latencyMs: response.latencyMs };
};

const submit = async (user, providerId, nonce, role) => {
	const submittedAt = Date.now();
	const response = await call("/provider-entities/imports", userHeaders(user), {
		providerId,
		externalId: externalId(nonce),
	});
	if (response.status !== 200) {
		fatal(`${role} import submission returned HTTP ${response.status}`);
	}
	const { jobId } = response.value;
	return {
		role,
		user,
		jobId,
		submittedAt,
		submitStatus: response.status,
		submitLatencyMs: response.latencyMs,
		key: jobId === null ? null : jobId.slice(0, jobId.lastIndexOf(".")),
	};
};

/** Polls every accepted job like the client does, until each reports a terminal status. */
const awaitTerminal = async (jobs) => {
	const startedAt = Date.now();
	const pending = new Set(jobs);
	let changedAt = Date.now();
	while (pending.size > 0) {
		if (Date.now() - startedAt > TIMEOUT_MS) {
			fatal(`${pending.size} imports did not finish within ${TIMEOUT_MS / 60_000} minutes`);
		}
		if (Date.now() - Math.max(changedAt, progress.at) > STALL_MS) {
			fatal(`${pending.size} imports pending with no progress for ${STALL_MS / 1000}s`);
		}
		for (const job of pending) {
			const result = await call(
				`/provider-entities/imports/${encodeURIComponent(job.jobId)}`,
				userHeaders(job.user),
			);
			if (result.status >= 400 && result.status < 500) {
				fatal(`${job.role} import result returned HTTP ${result.status}`);
			}
			const status = result.value?.status;
			if (status !== job.observedStatus) {
				job.observedStatus = status;
				changedAt = Date.now();
			}
			if (status !== undefined && status !== "queued" && status !== "running") {
				if (status !== "completed") {
					fatal(
						`${job.role} import ended ${status}: ${JSON.stringify(result.value.error ?? null)}`,
					);
				}
				job.status = status;
				job.observedTerminalAt = Date.now();
				pending.delete(job);
			}
		}
		if (pending.size > 0) {
			await Bun.sleep(RESULT_POLL_MS);
		}
	}
};

const percentile = (values, fraction) => {
	if (values.length === 0) {
		return null;
	}
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
};
const summarizeLatency = (samples) => {
	const latencies = samples.map(({ latencyMs }) => latencyMs);
	return {
		count: samples.length,
		p50Ms: percentile(latencies, 0.5),
		p95Ms: percentile(latencies, 0.95),
		failures: samples.filter(({ ok }) => !ok).length,
		maxMs: latencies.length === 0 ? null : Math.max(...latencies),
	};
};

const runScenario = async (repetition, segmentCursor) => {
	const nonce = `${label}-${invocation}-${scenario}-${repetition}`;
	const jobs = [];
	if (scenario === "single" || scenario === "warmup") {
		jobs.push(await submit(state.bulk, state.bulk.bookProviderId, `${nonce}-0`, "single"));
	} else if (scenario === "mixed") {
		jobs.push(
			...(await Promise.all(
				Array.from({ length: 20 }, (_, index) =>
					submit(state.bulk, state.bulk.bookProviderId, `${nonce}-${index}`, "bulk"),
				),
			)),
		);
		await Bun.sleep(OTHER_USER_DELAY_MS);
		jobs.push(await submit(state.other, state.other.bookProviderId, `${nonce}-other`, "other"));
	} else if (scenario === "slow") {
		jobs.push(await submit(state.bulk, state.bulk.slowBookProviderId, `${nonce}-slow`, "slow"));
		await Bun.sleep(SLOW_LEAD_MS);
		jobs.push(
			...(await Promise.all(
				Array.from({ length: 5 }, (_, index) =>
					submit(state.bulk, state.bulk.bookProviderId, `${nonce}-${index}`, "fast"),
				),
			)),
		);
	} else {
		throw new Error(`unknown scenario ${scenario}`);
	}
	await awaitTerminal(jobs);
	const { segments } = await phaseSegments(segmentCursor);
	const started = new Map();
	const finished = new Map();
	for (const segment of segments) {
		started.set(
			segment.executionId,
			Math.min(started.get(segment.executionId) ?? Infinity, segment.startedAtMs),
		);
		if (segment.phase === "provider-import-automation" && segment.outcome === "success") {
			finished.set(segment.executionId, segment.finishedAtMs);
		}
	}
	return {
		segmentCursor: segments.reduce(
			(sequence, segment) => Math.max(sequence, segment.sequence),
			segmentCursor,
		),
		jobs: jobs.map((job) => {
			const startedAt = job.key === null ? undefined : started.get(job.key);
			const finishedAt =
				(job.key === null ? undefined : finished.get(job.key)) ?? job.observedTerminalAt;
			return {
				role: job.role,
				submitLatencyMs: job.submitLatencyMs,
				status: job.status ?? `http-${job.submitStatus}`,
				submittedOffsetMs: job.submittedAt - jobs[0].submittedAt,
				queueWaitMs: startedAt === undefined ? null : startedAt - job.submittedAt,
				latencyMs: finishedAt === undefined ? null : finishedAt - job.submittedAt,
				completedOffsetMs: finishedAt === undefined ? null : finishedAt - jobs[0].submittedAt,
				executionMs:
					startedAt === undefined || finishedAt === undefined ? null : finishedAt - startedAt,
			};
		}),
	};
};

const initialSegments = await phaseSegments(0);
let segmentCursor = initialSegments.segments.reduce(
	(sequence, segment) => Math.max(sequence, segment.sequence),
	0,
);
for (let repetition = 0; repetition < repetitions; repetition += 1) {
	const idle = await waitForDrain(() => {});
	const peaks = {
		bunRss: 0,
		active: 0,
		denoRss: 0,
		workers: 0,
		cgroupMemory: 0,
		executingBodies: 0,
	};
	const series = [];
	let lastSeriesAt = 0;
	const observe = (current) => {
		peaks.cgroupMemory = Math.max(peaks.cgroupMemory, current.cgroup?.memoryCurrentBytes ?? 0);
		peaks.denoRss = Math.max(peaks.denoRss, current.deno.rssBytes);
		peaks.bunRss = Math.max(peaks.bunRss, current.backend.rssBytes);
		peaks.workers = Math.max(peaks.workers, current.deno.processCount);
		peaks.active = Math.max(peaks.active, current.executions.active);
		peaks.executingBodies = Math.max(
			peaks.executingBodies,
			current.providerImports.executingBodies,
		);
		if (current.timestampMs - lastSeriesAt >= SERIES_INTERVAL_MS) {
			lastSeriesAt = current.timestampMs;
			series.push([
				current.timestampMs,
				current.backend.rssBytes,
				current.deno.rssBytes,
				current.deno.processCount,
				current.cgroup?.memoryCurrentBytes ?? null,
				current.providerImports.executingBodies,
			]);
		}
	};
	let stop;
	const stopped = new Promise((resolve) => {
		stop = resolve;
	});
	const sampler = every(SAMPLE_INTERVAL_MS, stopped, async () => observe(await sample()));
	healthyAt = Date.now();
	const health = every(HEALTH_INTERVAL_MS, stopped, probeHealth);
	const searches = scenario === "mixed" ? every(SEARCH_INTERVAL_MS, stopped, probeSearch) : null;
	const probeCpuBefore = process.cpuUsage();
	const startedAt = Date.now();
	const outcome = await runScenario(repetition, segmentCursor);
	segmentCursor = outcome.segmentCursor;
	const terminalMs = Date.now() - startedAt;
	stop();
	await sampler;
	const healthSamples = await health;
	const searchSamples = searches === null ? [] : await searches;
	const drained = await waitForDrain(observe);
	const drainedMs = Date.now() - startedAt - IDLE_WINDOW_MS;
	const probeCpu = process.cpuUsage(probeCpuBefore);
	await Bun.sleep(SETTLE_MS);
	const settled = await sample();
	const delta = (select) => select(drained) - select(idle);
	const accepted = outcome.jobs.filter((job) => job.latencyMs !== null);
	const completedOffsets = accepted.map((job) => job.completedOffsetMs);
	const row = {
		label,
		series,
		scenario,
		drainedMs,
		repetition,
		terminalMs,
		jobs: outcome.jobs,
		peakBunRssBytes: peaks.bunRss,
		peakDenoRssBytes: peaks.denoRss,
		peakActiveExecutions: peaks.active,
		peakConcurrentWorkers: peaks.workers,
		idleBunRssBytes: idle.backend.rssBytes,
		workersLeft: drained.deno.processCount,
		health: summarizeLatency(healthSamples),
		search: summarizeLatency(searchSamples),
		peakCgroupMemoryBytes: peaks.cgroupMemory,
		peakExecutingBodies: peaks.executingBodies,
		settledBunRssBytes: settled.backend.rssBytes,
		processesSpawned: delta((value) => value.totalSpawned),
		replaysFailed: delta((value) => value.replays.totalFailed),
		sandboxExecutions: delta((value) => value.executions.total),
		replaysStarted: delta((value) => value.replays.totalStarted),
		oomEvents: delta((value) => value.cgroup?.events.oomKill ?? 0),
		settledCgroupMemoryBytes: settled.cgroup?.memoryCurrentBytes ?? null,
		failures: outcome.jobs.filter((job) => job.status !== "completed").length,
		lastCompletionMs: completedOffsets.length === 0 ? null : Math.max(...completedOffsets),
		firstCompletionMs: completedOffsets.length === 0 ? null : Math.min(...completedOffsets),
		bunCpuSeconds:
			delta((value) => (value.backend.userCpuMicros ?? 0) + (value.backend.systemCpuMicros ?? 0)) /
			1e6,
		// The probe shares the Ryot cgroup, so its own CPU is removed from the container total.
		ryotCpuSeconds:
			delta((value) => value.cgroup?.cpu.usageUsec ?? 0) / 1e6 -
			(probeCpu.user + probeCpu.system) / 1e6,
	};
	appendFileSync(`/tmp/${label}.jsonl`, `${JSON.stringify(row)}\n`, { mode: 0o600 });
	const { jobs: _jobs, series: _series, ...brief } = row;
	console.log(JSON.stringify(brief));
}
