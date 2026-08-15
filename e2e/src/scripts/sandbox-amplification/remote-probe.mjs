// Runs inside the benchmark application container with Bun, against the local API, so request
// latency excludes the public route. Usage:
//   bun remote-probe.mjs <state.json> <label> <direct:N|import|batch:N> <repetitions>
// `state.json` comes from remote-setup.ts. Each repetition waits for a drained runtime, then records
// counter, CPU, and memory deltas for exactly the work it submitted. Output: /tmp/<label>.jsonl.
import { appendFileSync, readFileSync } from "node:fs";

const [statePath, label, scenario, repetitionsText = "1"] = process.argv.slice(2);
if (!statePath || !/^[a-z0-9.-]+$/.test(label ?? "") || !scenario) {
	throw new Error("usage: remote-probe.mjs <state.json> <label> <direct:N|import|batch:N> <reps>");
}
const state = JSON.parse(readFileSync(statePath, "utf8"));
const repetitions = Number(repetitionsText);
const base = "http://127.0.0.1:8000/api";
const adminHeaders = {
	"Content-Type": "application/json",
	"Admin-Access-Token": process.env.SERVER_ADMIN_ACCESS_TOKEN,
};
const userHeaders = { "X-Api-Key": state.apiKey, "Content-Type": "application/json" };
const IDLE_WINDOW_MS = 3_000;
const SAMPLE_INTERVAL_MS = 250;
const TIMEOUT_MS = 30 * 60_000;

const request = async (path, headers, body) => {
	const response = await fetch(`${base}${path}`, {
		headers,
		signal: AbortSignal.timeout(90_000),
		method: body === undefined ? "GET" : "POST",
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	if (!response.ok) {
		throw new Error(`${path}: HTTP ${response.status}`);
	}
	return response.json();
};
const admin = (path, body) => request(`/test-support/${path}`, adminHeaders, body);
const sample = (cursor) =>
	admin(`sandbox/runtime?includeSmaps=false&completedAfterSequence=${cursor}`);
const phaseSegments = (after) => admin(`provider-imports/phase-segments?afterSequence=${after}`);

const workload = (overrides) => ({
	seed: 1,
	perCallDelayMs: 0,
	payloadBytes: 1024,
	suggestionCount: 0,
	durableHostCalls: 0,
	relatedEntityCount: 0,
	terminalOutcome: "success",
	...overrides,
});
const STANDARD_IMPORT = workload({
	seed: 71,
	perCallDelayMs: 25,
	suggestionCount: 10,
	durableHostCalls: 5,
	relatedEntityCount: 10,
});
const externalId = (context, nonce) =>
	[
		"bm",
		context.seed,
		context.relatedEntityCount,
		context.suggestionCount,
		context.durableHostCalls,
		context.payloadBytes,
		context.perCallDelayMs,
		context.terminalOutcome,
		nonce,
	].join(".");

const isIdle = (value) =>
	value.executions.active === 0 &&
	value.activeProcessCount === 0 &&
	value.providerImports.executingBodies === 0;

// Drained means idle with no new spawn for a whole window, so detached automations are included.
const waitForDrain = async (cursor, observe) => {
	const startedAt = Date.now();
	let idleSince = null;
	let spawned = null;
	for (;;) {
		if (Date.now() - startedAt > TIMEOUT_MS) {
			throw new Error("runtime did not drain");
		}
		const current = await sample(cursor.value);
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

const runDirect = async (iterations, repetition) => {
	const startedAt = Date.now();
	const queued = await admin("sandbox/enqueue", {
		scriptId: state.scriptId,
		executingUserId: state.userId,
		context: workload({
			durableHostCalls: iterations,
			seed: 1_000 + iterations * 100 + repetition,
		}),
	});
	for (;;) {
		const result = await admin(
			`sandbox/result/${encodeURIComponent(queued.jobId)}?executingUserId=${state.userId}`,
		);
		if (result.status !== "pending") {
			const ok = result.status === "completed" && result.error === null;
			return [{ ok, latencyMs: Date.now() - startedAt }];
		}
		await Bun.sleep(100);
	}
};

const runImports = async (count, repetition, segmentCursor) => {
	const nonce = `${label}-${scenario.replace(":", "")}-${repetition}`;
	const startedAt = Date.now();
	const jobs = await Promise.all(
		Array.from({ length: count }, (_, index) =>
			request("/provider-entities/imports", userHeaders, {
				providerId: state.bookProviderId,
				externalId: externalId(STANDARD_IMPORT, `${nonce}-${index}`),
			}).then(({ jobId }) => ({ jobId, key: jobId.slice(0, jobId.lastIndexOf(".")) })),
		),
	);
	const finishedAt = new Map();
	let after = segmentCursor;
	while (finishedAt.size < jobs.length) {
		if (Date.now() - startedAt > TIMEOUT_MS) {
			throw new Error("imports did not finish");
		}
		await Bun.sleep(SAMPLE_INTERVAL_MS);
		const { segments } = await phaseSegments(after);
		for (const segment of segments) {
			after = Math.max(after, segment.sequence);
			if (segment.phase === "provider-import-automation" && segment.outcome === "success") {
				finishedAt.set(segment.executionId, segment.finishedAtMs);
			}
		}
	}
	const outcomes = [];
	for (const job of jobs) {
		const result = await request(
			`/provider-entities/imports/${encodeURIComponent(job.jobId)}`,
			userHeaders,
		);
		outcomes.push({
			ok: result.status === "completed",
			latencyMs: (finishedAt.get(job.key) ?? Date.now()) - startedAt,
		});
	}
	return outcomes;
};

const [kind, amountText] = scenario.split(":");
const amount = Number(amountText ?? "1");
const initialSegments = await phaseSegments(0);
let segmentCursor = initialSegments.segments.reduce(
	(sequence, segment) => Math.max(sequence, segment.sequence),
	0,
);
for (let repetition = 0; repetition < repetitions; repetition += 1) {
	const cursor = { value: 0 };
	const idle = await waitForDrain(cursor, () => {});
	cursor.value = idle.completedWorkerSequence;
	const peaks = { bunRss: 0, denoRss: 0, workers: 0, workerRss: 0, cgroupMemory: 0 };
	const observe = (current) => {
		peaks.cgroupMemory = Math.max(peaks.cgroupMemory, current.cgroup?.memoryCurrentBytes ?? 0);
		peaks.denoRss = Math.max(peaks.denoRss, current.deno.rssBytes);
		peaks.bunRss = Math.max(peaks.bunRss, current.backend.rssBytes);
		peaks.workers = Math.max(peaks.workers, current.deno.processCount);
		for (const worker of current.completedWorkers) {
			peaks.workerRss = Math.max(peaks.workerRss, worker.lifetimePeakRssBytes ?? 0);
			cursor.value = Math.max(cursor.value, worker.sequence);
		}
	};
	let sampling = true;
	const sampler = (async () => {
		while (sampling) {
			observe(await sample(cursor.value));
			await Bun.sleep(SAMPLE_INTERVAL_MS);
		}
	})();
	const probeCpuBefore = process.cpuUsage();
	const startedAt = Date.now();
	const requests =
		kind === "direct"
			? await runDirect(amount, repetition)
			: await runImports(kind === "batch" ? amount : 1, repetition, segmentCursor);
	const submittedWorkMs = Date.now() - startedAt;
	sampling = false;
	await sampler;
	const after = await waitForDrain(cursor, observe);
	const drainedMs = Date.now() - startedAt - IDLE_WINDOW_MS;
	const probeCpu = process.cpuUsage(probeCpuBefore);
	const probeCpuSeconds = (probeCpu.user + probeCpu.system) / 1e6;
	const { segments } = await phaseSegments(segmentCursor);
	segmentCursor = segments.reduce(
		(sequence, segment) => Math.max(sequence, segment.sequence),
		segmentCursor,
	);
	const delta = (select) => select(after) - select(idle);
	const row = {
		label,
		scenario,
		drainedMs,
		repetition,
		submittedWorkMs,
		probeCpuSeconds,
		requests: requests.length,
		peakBunRssBytes: peaks.bunRss,
		peakDenoRssBytes: peaks.denoRss,
		peakWorkerRssBytes: peaks.workerRss,
		peakConcurrentWorkers: peaks.workers,
		workersLeft: after.deno.processCount,
		peakCgroupMemoryBytes: peaks.cgroupMemory,
		failures: requests.filter(({ ok }) => !ok).length,
		latencyMs: requests.map(({ latencyMs }) => latencyMs),
		processesSpawned: delta((value) => value.totalSpawned),
		replaysFailed: delta((value) => value.replays.totalFailed),
		sandboxExecutions: delta((value) => value.executions.total),
		replaysStarted: delta((value) => value.replays.totalStarted),
		oomEvents: delta((value) => value.cgroup?.events.oomKill ?? 0),
		replaysCompleted: delta((value) => value.replays.totalCompleted),
		durableRequests: delta((value) => value.replays.totalDurableRequests),
		observedJournalBytes: delta((value) => value.replays.totalJournalBytes),
		// The probe shares the Ryot cgroup, so its own CPU is removed from the container total.
		ryotCpuSeconds: delta((value) => value.cgroup?.cpu.usageUsec ?? 0) / 1e6 - probeCpuSeconds,
		bunCpuSeconds:
			delta((value) => (value.backend.userCpuMicros ?? 0) + (value.backend.systemCpuMicros ?? 0)) /
			1e6,
	};
	appendFileSync(`/tmp/${label}.jsonl`, `${JSON.stringify(row)}\n`, { mode: 0o600 });
	console.log(JSON.stringify(row));
}
