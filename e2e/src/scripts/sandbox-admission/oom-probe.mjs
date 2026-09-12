// Runs inside the benchmark application container with Bun. Submits `count` direct executions of
// the memory workload script, each holding `allocateMiB` for `holdMs`, and probes health every
// second until every execution is terminal. Usage:
//   bun oom-probe.mjs <state.json> <label> <count> <allocateMiB> <holdMs>
// Output: one JSON line on stdout and in /tmp/<label>.jsonl.
import { appendFileSync, readFileSync } from "node:fs";

/* oxlint-disable no-await-in-loop -- Sequential polls and measurements are part of the probe. */

const [statePath, label, countText, allocateText, holdText] = process.argv.slice(2);
const state = JSON.parse(readFileSync(statePath, "utf8"));
const base = "http://127.0.0.1:8000/api";
const headers = {
	"Content-Type": "application/json",
	"Admin-Access-Token": process.env.SERVER_ADMIN_ACCESS_TOKEN,
};
const TIMEOUT_MS = 10 * 60_000;

const admin = async (path, body) => {
	const response = await fetch(`${base}/test-support/${path}`, {
		headers,
		signal: AbortSignal.timeout(30_000),
		method: body === undefined ? "GET" : "POST",
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	return { status: response.status, value: await response.json().catch(() => null) };
};

const health = [];
let done = false;
const healthLoop = (async () => {
	while (!done) {
		const startedAt = performance.now();
		const ok = await fetch(`${base}/system/health`, { signal: AbortSignal.timeout(5_000) })
			.then((response) => response.ok)
			.catch(() => false);
		health.push({ ok, latencyMs: performance.now() - startedAt });
		await Bun.sleep(1_000);
	}
})();

const before = (await admin("sandbox/runtime?includeSmaps=false&completedAfterSequence=0")).value;
const jobs = await Promise.all(
	Array.from({ length: Number(countText) }, () =>
		admin("sandbox/enqueue", {
			executingUserId: state.bulk.userId,
			scriptId: state.bulk.memoryScriptId,
			context: { holdMs: Number(holdText), allocateMiB: Number(allocateText) },
		}).then(({ value }) => ({ jobId: value.jobId, startedAt: Date.now() })),
	),
);
const startedAt = Date.now();
for (const job of jobs) {
	while (job.outcome === undefined) {
		if (Date.now() - startedAt > TIMEOUT_MS) {
			job.outcome = "timeout";
			break;
		}
		const result = await admin(
			`sandbox/result/${encodeURIComponent(job.jobId)}?executingUserId=${state.bulk.userId}`,
		).catch(() => ({ status: 0 }));
		if (result.status === 200 && result.value.status !== "pending") {
			job.outcome =
				result.value.status === "completed" && result.value.error === null
					? "completed"
					: `failed:${result.value.error?.kind ?? result.value.status}`;
			job.latencyMs = Date.now() - job.startedAt;
		} else {
			await Bun.sleep(500);
		}
	}
}
done = true;
await healthLoop;
const after = (await admin("sandbox/runtime?includeSmaps=false&completedAfterSequence=0")).value;
const row = {
	label,
	count: Number(countText),
	holdMs: Number(holdText),
	healthChecks: health.length,
	allocateMiB: Number(allocateText),
	healthFailures: health.filter(({ ok }) => !ok).length,
	healthMaxMs: Math.max(...health.map(({ latencyMs }) => latencyMs)),
	outcomes: jobs.map(({ outcome, latencyMs }) => ({ outcome, latencyMs })),
	processesSpawned: after && before ? after.totalSpawned - before.totalSpawned : null,
	backendRestarted: before === null || after === null || after.totalSpawned < before.totalSpawned,
	cgroupOomKills:
		after?.cgroup && before?.cgroup
			? after.cgroup.events.oomKill - before.cgroup.events.oomKill
			: null,
};
appendFileSync(`/tmp/${label}.jsonl`, `${JSON.stringify(row)}\n`, { mode: 0o600 });
console.log(JSON.stringify(row));
