// Run inside the benchmark application container. Writes only bounded diagnostic data.
import { writeFileSync } from "node:fs";

const [scriptId, userId, label, mode = "normal"] = process.argv.slice(2);
const pollIntervalMs = Number(process.env.DIAGNOSTIC_POLL_MS ?? 200);
if (
	!scriptId ||
	!userId ||
	!/^[a-z0-9-]+$/.test(label ?? "") ||
	!["normal", "cpu", "deno", "single"].includes(mode)
)
	throw new Error("scriptId userId label [normal|cpu|deno|single]");
if (!Number.isFinite(pollIntervalMs) || !Number.isInteger(pollIntervalMs) || pollIntervalMs < 1)
	throw new Error("DIAGNOSTIC_POLL_MS must be a finite integer >= 1");
const headers = {
	"Admin-Access-Token": process.env.SERVER_ADMIN_ACCESS_TOKEN,
	"Content-Type": "application/json",
};
const api = async (path, body) => {
	const response = await fetch(`http://127.0.0.1:8000/api/test-support/${path}`, {
		headers,
		method: body === undefined ? "GET" : "POST",
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
		signal: AbortSignal.timeout(90000),
	});
	if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
	return response.json();
};
const sample = (cursor = 0) =>
	api(`sandbox/runtime?includeSmaps=false&completedAfterSequence=${cursor}`);
const profile = (action) =>
	api("benchmark/backend-profile", { token: label, label: "work", action });
const start = await sample();
if (start.executions.active !== 0 || start.providerImports.executingBodies !== 0)
	throw new Error("Benchmark deployment is busy");
const rows = [];
let profiling = false;
try {
	if (mode === "cpu") {
		await profile("cpu-start");
		profiling = true;
	}
	const rounds = mode === "normal" ? 3 : 1;
	for (let round = 0; round < rounds; round++) {
		const cases =
			mode === "single"
				? [[4, 0]]
				: round % 2 === 0
					? [
							[0, 0],
							[1, 0],
							[4, 0],
							[0, 1048576],
						]
					: [
							[0, 1048576],
							[4, 0],
							[1, 0],
							[0, 0],
						];
		for (const [pairs, bytes] of cases) {
			if (mode === "deno") {
				const script = await api(`sandbox-scripts/${scriptId}`);
				await api("benchmark/sandbox-profile", {
					token: `${label}-${pairs}-${bytes}`,
					scriptSlug: script.slug,
					executions: 1,
					cpuProfile: true,
					maxAttemptsPerExecution: 24,
					maxHeapSnapshotsPerAttempt: 0,
				});
			}
			const before = await sample(start.completedWorkerSequence);
			const startedAt = Date.now();
			const queued = await api("sandbox/enqueue", {
				executingUserId: userId,
				scriptId,
				context: {
					seed: 42,
					payloadBytes: bytes,
					perCallDelayMs: 0,
					suggestionCount: 0,
					durableHostCalls: pairs,
					relatedEntityCount: 0,
					terminalOutcome: "success",
				},
			});
			let result;
			let polls = 0;
			do {
				if (Date.now() - startedAt > 90000) throw new Error("Diagnostic request timed out");
				await Bun.sleep(pollIntervalMs);
				result = await api(
					`sandbox/result/${encodeURIComponent(queued.jobId)}?executingUserId=${userId}`,
				);
				polls++;
			} while (result.status === "pending");
			const endedAt = Date.now();
			const after = await sample(before.completedWorkerSequence);
			const workers = after.completedWorkers.filter((w) => w.executionKey === queued.executionId);
			const executionMs = workers.reduce((sum, w) => sum + w.releasedAtMs - w.spawnedAtMs, 0);
			const interWorkerMs = workers
				.slice(1)
				.reduce((sum, w, index) => sum + w.spawnedAtMs - workers[index].releasedAtMs, 0);
			const row = {
				round,
				pairs,
				bytes,
				startedAt,
				endedAt,
				executionId: queued.executionId,
				polls,
				status: result.status,
				error: result.error,
				latencyMs: endedAt - startedAt,
				executionMs,
				interWorkerMs,
				firstWorkerWaitMs: workers.length ? workers[0].spawnedAtMs - startedAt : null,
				terminalGapMs: workers.length ? endedAt - workers.at(-1).releasedAtMs : null,
				terminalTiming: result.timing,
				workers,
				backendCpuMs:
					(after.backend.userCpuMicros +
						after.backend.systemCpuMicros -
						(before.backend.userCpuMicros + before.backend.systemCpuMicros)) /
					1000,
				replaysBefore: before.replays,
				replaysAfter: after.replays,
			};
			rows.push(row);
			writeFileSync(
				`/tmp/${label}.json`,
				JSON.stringify(
					{
						label,
						mode,
						pollIntervalMs,
						configuration: start.configuration,
						runtime: start.runtime,
						rows,
					},
					null,
					2,
				),
				{ mode: 0o600 },
			);
			console.log(
				JSON.stringify({
					round,
					pairs,
					bytes,
					status: row.status,
					latencyMs: row.latencyMs,
					executionMs,
					interWorkerMs,
					workers: workers.length,
					backendCpuMs: row.backendCpuMs,
				}),
			);
			if (mode !== "deno" && (result.status !== "completed" || result.error !== null))
				throw new Error("Diagnostic execution failed");
		}
	}
} finally {
	if (profiling) await profile("cpu-stop");
}
