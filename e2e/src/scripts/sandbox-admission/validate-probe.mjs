// Runs inside the benchmark application container with Bun, against an arm with import admission
// enabled, and checks the admission lifecycle rather than measuring it. Usage:
//   bun validate-probe.mjs <state.json> <label> <check>
// Checks: restart-submit and restart-await (the host restarts the container between them), cancel,
// duplicate, backlog, worker-kill. Each prints one JSON line and appends it to /tmp/<label>.jsonl;
// any violated expectation exits non-zero.
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

/* oxlint-disable no-await-in-loop -- Sequential polls are part of the probe. */

const [statePath, label, check] = process.argv.slice(2);
if (!statePath || !/^[a-z0-9.-]+$/.test(label ?? "") || !check) {
	throw new Error("usage: validate-probe.mjs <state.json> <label> <check>");
}
const state = JSON.parse(readFileSync(statePath, "utf8"));
const base = "http://127.0.0.1:8000/api";
const JOBS_PATH = "/tmp/adm-validate-jobs.json";
const POLL_MS = 1_000;
const TERMINAL_TIMEOUT_MS = 20 * 60_000;
const BACKLOG_LIMIT = 50;

const fatal = (message) => {
	console.error(`validation failed: ${label} ${check}: ${message}`);
	process.exit(1);
};

const call = async (path, user, method, body) => {
	const response = await fetch(`${base}${path}`, {
		method,
		signal: AbortSignal.timeout(90_000),
		headers: { "X-Api-Key": user.apiKey, "Content-Type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	return { status: response.status, value: await response.json().catch(() => null) };
};

const invocation = Date.now().toString(36);
const externalId = (name) =>
	["bm", 71, 10, 10, 5, 1024, 25, "success", `${label}-${invocation}-${name}`].join(".");

const submit = async (user, name) => {
	const response = await call("/provider-entities/imports", user, "POST", {
		externalId: externalId(name),
		providerId: user.bookProviderId,
	});
	return { name, value: response.value, status: response.status, jobId: response.value?.jobId };
};
const accepted = async (user, name) => {
	const job = await submit(user, name);
	if (job.status !== 200) {
		fatal(`${name} submission returned HTTP ${job.status}`);
	}
	return job;
};
const statusOf = async (user, jobId) => {
	const response = await call(
		`/provider-entities/imports/${encodeURIComponent(jobId)}`,
		user,
		"GET",
	);
	if (response.status !== 200) {
		fatal(`result for ${jobId.slice(0, 8)} returned HTTP ${response.status}`);
	}
	return response.value.status;
};
const cancel = async (user, jobId) => {
	const response = await call(
		`/provider-entities/imports/${encodeURIComponent(jobId)}`,
		user,
		"DELETE",
	);
	if (response.status !== 200) {
		fatal(`cancel returned HTTP ${response.status}`);
	}
};
const statuses = (user, jobs) => Promise.all(jobs.map((job) => statusOf(user, job.jobId)));

/** Polls until `done` holds for the current statuses of `jobs`; returns them. */
const until = async (user, jobs, done, what) => {
	const startedAt = Date.now();
	for (;;) {
		const current = await statuses(user, jobs);
		if (done(current)) {
			return current;
		}
		if (Date.now() - startedAt > TERMINAL_TIMEOUT_MS) {
			fatal(`${what} not reached; statuses ${current.join(",")}`);
		}
		await Bun.sleep(POLL_MS);
	}
};
const isTerminal = (status) => status !== "queued" && status !== "running";
const allTerminal = (current) => current.every(isTerminal);
const expectAll = (current, expected, what) => {
	if (!current.every((status) => status === expected)) {
		fatal(`${what}: expected ${expected}, got ${current.join(",")}`);
	}
};
const record = (row) => {
	const line = JSON.stringify({ label, check, ...row });
	appendFileSync(`/tmp/${label}.jsonl`, `${line}\n`, { mode: 0o600 });
	console.log(line);
};

/** Kills every Deno sandbox worker in this container, as an out-of-memory kill would. */
const killWorkers = () => {
	const killed = [];
	for (const entry of readdirSync("/proc")) {
		if (!/^\d+$/.test(entry)) {
			continue;
		}
		const command = (() => {
			try {
				return readFileSync(`/proc/${entry}/cmdline`, "utf8");
			} catch {
				return "";
			}
		})();
		if (command.split("\0")[0]?.endsWith("deno")) {
			try {
				process.kill(Number(entry), "SIGKILL");
				killed.push(Number(entry));
			} catch {}
		}
	}
	return killed.length;
};

const { bulk, other } = state;

if (check === "restart-submit") {
	// With two slots, six imports leave two running and four queued when the container restarts.
	const jobs = await Promise.all(
		Array.from({ length: 6 }, (_, index) => accepted(bulk, `r${index}`)),
	);
	const current = await until(
		bulk,
		jobs,
		(values) => values.includes("running") && values.includes("queued"),
		"running and queued imports",
	);
	// Let the admitted imports get well into their sandbox work before the restart.
	await Bun.sleep(20_000);
	writeFileSync(JOBS_PATH, JSON.stringify(jobs), { mode: 0o600 });
	record({ firstObserved: current, beforeRestart: await statuses(bulk, jobs) });
} else if (check === "restart-await") {
	const jobs = JSON.parse(readFileSync(JOBS_PATH, "utf8"));
	const afterRestart = await statuses(bulk, jobs);
	const final = await until(bulk, jobs, allTerminal, "terminal imports after restart");
	expectAll(final, "completed", "imports after restart");
	// A repeated request for a finished import is a new job, not the old one.
	const again = await accepted(bulk, "r0");
	if (again.jobId === jobs[0].jobId) {
		fatal("a finished import returned its old job");
	}
	await cancel(bulk, again.jobId);
	record({ final, afterRestart });
} else if (check === "cancel") {
	const jobs = await Promise.all(
		Array.from({ length: 3 }, (_, index) => accepted(bulk, `c${index}`)),
	);
	const current = await until(
		bulk,
		jobs,
		(values) => values.filter((status) => status === "running").length === 2,
		"two admitted imports",
	);
	const queued = jobs[current.indexOf("queued")];
	const running = jobs[current.indexOf("running")];
	if (!queued || !running) {
		fatal(`expected one queued and two running, got ${current.join(",")}`);
	}
	await cancel(bulk, queued.jobId);
	const queuedAfter = await statusOf(bulk, queued.jobId);
	await cancel(bulk, running.jobId);
	const [runningAfter] = await until(bulk, [running], allTerminal, "cancelled running import");
	const remaining = jobs.filter((job) => job !== queued && job !== running);
	const remainingFinal = await until(bulk, remaining, allTerminal, "uncancelled import");
	if (queuedAfter !== "cancelled" || runningAfter !== "cancelled") {
		fatal(`cancelled imports ended ${queuedAfter} (queued) and ${runningAfter} (running)`);
	}
	expectAll(remainingFinal, "completed", "uncancelled import");
	record({ queuedAfter, runningAfter, remainingFinal, beforeCancel: current });
} else if (check === "duplicate") {
	const first = await accepted(bulk, "d0");
	const repeated = await Promise.all(Array.from({ length: 5 }, () => accepted(bulk, "d0")));
	const distinct = new Set([first, ...repeated].map((job) => job.jobId)).size;
	if (distinct !== 1) {
		fatal(`six requests for one pending import returned ${distinct} jobs`);
	}
	const final = await until(bulk, [first], allTerminal, "duplicated import");
	expectAll(final, "completed", "duplicated import");
	record({ final, distinctJobs: distinct });
} else if (check === "backlog") {
	const jobs = [];
	for (let index = 0; index < BACKLOG_LIMIT; index += 1) {
		jobs.push(await accepted(other, `b${index}`));
	}
	const rejected = await submit(other, "b-over");
	const reason = rejected.value?.reason;
	if (
		rejected.status !== 429 ||
		reason?.code !== "import-backlog-full" ||
		!(reason.retryAfterSeconds > 0)
	) {
		fatal(
			`over-limit submission returned HTTP ${rejected.status} ${JSON.stringify(reason ?? null)}`,
		);
	}
	// A full backlog belongs to its user: another user still gets admitted work.
	const neighbour = await accepted(bulk, "b-neighbour");
	await Promise.all(jobs.map((job) => cancel(other, job.jobId)));
	const final = await until(other, jobs, allTerminal, "cancelled backlog");
	expectAll(final, "cancelled", "cancelled backlog");
	const [neighbourFinal] = await until(bulk, [neighbour], allTerminal, "neighbour import");
	if (neighbourFinal !== "completed") {
		fatal(`neighbour import ended ${neighbourFinal}`);
	}
	const after = await accepted(other, "b-after");
	const [afterFinal] = await until(other, [after], allTerminal, "import after drained backlog");
	if (afterFinal !== "completed") {
		fatal(`import after drained backlog ended ${afterFinal}`);
	}
	record({
		afterFinal,
		neighbourFinal,
		accepted: jobs.length,
		rejected: { reason, status: rejected.status },
	});
} else if (check === "worker-kill") {
	const jobs = await Promise.all(
		Array.from({ length: 2 }, (_, index) => accepted(bulk, `k${index}`)),
	);
	await until(
		bulk,
		jobs,
		(values) => values.every((status) => status === "running"),
		"admitted imports",
	);
	await Bun.sleep(20_000);
	const killed = killWorkers();
	if (killed === 0) {
		fatal("no sandbox workers were running to kill");
	}
	const final = await until(bulk, jobs, allTerminal, "imports after worker kill");
	// The next import proves the slots were released rather than held by the failed work.
	const next = await accepted(bulk, "k-next");
	const [nextFinal] = await until(bulk, [next], allTerminal, "import after worker kill");
	if (nextFinal !== "completed") {
		fatal(`import after worker kill ended ${nextFinal}`);
	}
	record({ final, killed, nextFinal });
} else {
	fatal(`unknown check ${check}`);
}
