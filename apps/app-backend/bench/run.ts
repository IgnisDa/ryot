// TEMP(sandbox-benchmark): drive a real show through its completion timeline and
// report per-script sandbox timing. Requires the backend running on :3000 with
// the bench instrumentation active (sentinel toggled by this script).
//
//   bun run bench/run.ts <tmdbId> [label]
//
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { Queue } from "bullmq";

import type { SandboxBenchSample } from "../src/lib/sandbox/bench-recorder";
import { api, authenticate } from "./lib";

const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6380");
const connection = { host: redisUrl.hostname, port: Number(redisUrl.port || 6379) };
const eventQueue = new Queue("event", { connection });
const sandboxQueue = new Queue("sandbox", { connection });

async function queuesBusy(): Promise<boolean> {
	const [ev, sb] = await Promise.all([eventQueue.getJobCounts(), sandboxQueue.getJobCounts()]);
	const pending = (c: Record<string, number>) =>
		(c.waiting ?? 0) + (c.active ?? 0) + (c.delayed ?? 0) + (c.prioritized ?? 0) + (c.paused ?? 0);
	return pending(ev) + pending(sb) > 0;
}

async function waitForQueuesIdle(maxMs = 180_000) {
	const deadline = Date.now() + maxMs;
	let idleStreak = 0;
	while (Date.now() < deadline) {
		await sleep(500);
		if (await queuesBusy()) {
			idleStreak = 0;
		} else if (++idleStreak >= 3) {
			return;
		}
	}
}

const SENTINEL = "/tmp/ryot-sandbox-bench.on";
const OUTPUT = "/tmp/ryot-sandbox-bench.jsonl";

const SPECIAL_SEASONS = new Set(["Specials", "Extras"]);
const TRIGGER_SLUGS = new Set([
	"trigger.integration-progress-policy",
	"trigger.auto-complete-on-full-progress",
	"trigger.jellyfin-push",
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Episode = { season: number; episode: number };

const arg = (i: number) => process.argv[i];
const tmdbId = arg(2) ?? "1437";
const label = arg(3) ?? `tmdb-${tmdbId}`;
// Spacing between progress posts. 0 = realistic burst (pool churns); a large
// value (e.g. 1200) lets the pre-warmed pool refill, exposing the warm floor.
const interPostDelay = Number(process.env.RYOT_BENCH_DELAY ?? "0");

function readSamples(): SandboxBenchSample[] {
	if (!existsSync(OUTPUT)) {return [];}
	return readFileSync(OUTPUT, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as SandboxBenchSample);
}

function pct(sorted: number[], p: number): number {
	if (sorted.length === 0) {return 0;}
	const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
	return sorted[idx]!;
}

function stats(values: number[]) {
	const sorted = [...values].sort((a, b) => a - b);
	const sum = sorted.reduce((a, b) => a + b, 0);
	return {
		n: sorted.length,
		sum: Math.round(sum),
		min: sorted[0] ?? 0,
		max: sorted[sorted.length - 1] ?? 0,
		mean: sorted.length ? +(sum / sorted.length).toFixed(1) : 0,
		p50: pct(sorted, 50),
		p95: pct(sorted, 95),
	};
}

async function discover(session: Awaited<ReturnType<typeof authenticate>>) {
	const schemas = await api(session, "POST", "/api/entity-schemas/list", { slugs: ["show"] });
	// oxlint-disable-next-line no-unsafe-type-assertion
	const show = (
		schemas.data as {
			data: Array<{
				id: string;
				slug: string;
				providers: Array<{ name: string; scriptId: string }>;
			}>;
		}
	).data.find((s) => s.slug === "show");
	if (!show) {throw new Error("show entity schema not found");}
	const tmdb = show.providers.find((p) => p.name === "TMDB");
	if (!tmdb) {throw new Error("TMDB provider not found on show schema");}
	const events = await api(
		session,
		"GET",
		`/api/event-schemas?entitySchemaId=${encodeURIComponent(show.id)}`,
	);
	// oxlint-disable-next-line no-unsafe-type-assertion
	const eventList = (events.data as { data: Array<{ id: string; slug: string }> }).data;
	const progress = eventList.find((e) => e.slug === "progress");
	const complete = eventList.find((e) => e.slug === "complete");
	if (!progress || !complete) {throw new Error("progress/complete event schema not found");}
	return {
		showSchemaId: show.id,
		tmdbScriptId: tmdb.scriptId,
		progressId: progress.id,
		completeId: complete.id,
	};
}

async function importShow(
	session: Awaited<ReturnType<typeof authenticate>>,
	ctx: { showSchemaId: string; tmdbScriptId: string },
) {
	const t0 = performance.now();
	const enq = await api(session, "POST", "/api/entities/import", {
		externalId: tmdbId,
		scriptId: ctx.tmdbScriptId,
		entitySchemaId: ctx.showSchemaId,
	});
	// oxlint-disable-next-line no-unsafe-type-assertion
	const jobId = (enq.data as { data?: { jobId?: string } }).data?.jobId;
	if (!jobId) {throw new Error(`import enqueue failed: ${JSON.stringify(enq.data)}`);}

	for (let i = 0; i < 180; i++) {
		await sleep(1000);
		const poll = await api(session, "GET", `/api/entities/import/${jobId}`);
		// oxlint-disable-next-line no-unsafe-type-assertion
		const result = (poll.data as { data?: { status?: string; data?: unknown } }).data;
		if (result?.status === "completed") {
			// oxlint-disable-next-line no-unsafe-type-assertion
			const entity = result.data as {
				id: string;
				name: string;
				properties: {
					showSeasons?: Array<{
						name: string;
						seasonNumber: number;
						episodes: Array<{ episodeNumber: number }>;
					}>;
				};
			};
			return { entity, importMs: Math.round(performance.now() - t0) };
		}
		if (result?.status === "failed") {throw new Error(`import failed: ${JSON.stringify(result)}`);}
	}
	throw new Error("import timed out");
}

function episodesFrom(entity: {
	properties: {
		showSeasons?: Array<{
			name: string;
			seasonNumber: number;
			episodes: Array<{ episodeNumber: number }>;
		}>;
	};
}): Episode[] {
	const seasons = entity.properties.showSeasons ?? [];
	const eps: Episode[] = [];
	for (const season of seasons) {
		if (SPECIAL_SEASONS.has(season.name) || season.seasonNumber <= 0) {continue;}
		for (const ep of season.episodes) {
			eps.push({ season: season.seasonNumber, episode: ep.episodeNumber });
		}
	}
	return eps;
}

function reportGroup(title: string, samples: SandboxBenchSample[]) {
	if (samples.length === 0) {return;}
	console.log(`\n${title}`);
	const bySlug = new Map<string, SandboxBenchSample[]>();
	for (const s of samples) {
		const key = `${s.scriptSlug ?? s.scriptId}${s.phase ? ` [${s.phase}]` : ""}`;
		const arr = bySlug.get(key) ?? [];
		arr.push(s);
		bySlug.set(key, arr);
	}
	const rows = [...bySlug.entries()].sort((a, b) => b[1].length - a[1].length);
	for (const [key, arr] of rows) {
		const total = stats(arr.map((s) => s.totalMs));
		const exec = stats(arr.map((s) => s.scriptExecMs));
		const proc = stats(arr.map((s) => s.processMs));
		const hostCalls = stats(arr.map((s) => s.hostCalls));
		const memMb = stats(arr.map((s) => Math.round(s.memRssBytes / 1e6)));
		const poolHitRate = Math.round((arr.filter((s) => s.poolHit).length / arr.length) * 100);
		const totalCalls = arr.reduce((a, s) => a + s.hostCalls, 0);
		const execSum = arr.reduce((a, s) => a + s.scriptExecMs, 0);
		const perCall = totalCalls > 0 ? +(execSum / totalCalls).toFixed(1) : 0;
		console.log(`  ${key}`);
		console.log(
			`    runs=${arr.length}  poolHit=${poolHitRate}%  hostCalls(mean)=${hostCalls.mean}` +
				`  rssMB(mean)=${memMb.mean}  totalSum=${total.sum}ms`,
		);
		console.log(
			`    total      ms  p50=${total.p50} p95=${total.p95} mean=${total.mean} min=${total.min} max=${total.max}`,
		);
		console.log(
			`    process    ms  p50=${proc.p50} p95=${proc.p95} mean=${proc.mean} min=${proc.min}   (checkout+io+deno+exit)`,
		);
		console.log(
			`    scriptExec ms  p50=${exec.p50} p95=${exec.p95} mean=${exec.mean}` +
				(perCall > 0
					? `   (~${perCall}ms per host call, ${hostCalls.mean} calls)`
					: `   (deno body)`),
		);
	}
}

async function main() {
	console.log(`# Benchmark run: ${label} (tmdb ${tmdbId})`);
	const session = await authenticate();
	const ctx = await discover(session);

	// Make sure no prior work is still draining before we start recording.
	await waitForQueuesIdle(60_000);

	// Enable instrumentation and start from a clean slate.
	writeFileSync(SENTINEL, "");
	writeFileSync(OUTPUT, "");
	const runStart = Date.now();

	const { entity, importMs } = await importShow(session, ctx);
	const episodes = episodesFrom(entity);
	console.log(
		`\nimported "${entity.name}" in ${importMs}ms; non-special episodes = ${episodes.length}`,
	);
	if (episodes.length === 0) {throw new Error("no non-special episodes to complete");}

	const completionStart = Date.now();
	const postLatencies: number[] = [];
	const requiredKeys = episodes.map((e) => `${e.season}-${e.episode}`);
	// Strictly increasing occurredAt so the auto-complete emitter chronology is
	// unambiguous regardless of async processing order.
	let occurred = Date.now() - episodes.length * 60_000;

	const keyToEpisode = new Map(episodes.map((e) => [`${e.season}-${e.episode}`, e]));

	const postKeys = async (keys: string[]) => {
		for (const key of keys) {
			const ep = keyToEpisode.get(key)!;
			occurred += 60_000;
			const t0 = performance.now();
			const res = await api(session, "POST", "/api/events", [
				{
					entityId: entity.id,
					eventSchemaId: ctx.progressId,
					occurredAt: new Date(occurred).toISOString(),
					properties: { progressPercent: 100, showSeason: ep.season, showEpisode: ep.episode },
				},
			]);
			postLatencies.push(performance.now() - t0);
			if (res.status !== 200) {throw new Error(`event POST failed (${res.status})`);}
			if (interPostDelay > 0) {await sleep(interPostDelay);}
		}
	};

	const coverageState = async () => {
		const completeRes = await api(
			session,
			"GET",
			`/api/events?entityId=${encodeURIComponent(entity.id)}&eventSchemaSlug=complete`,
		);
		// oxlint-disable-next-line no-unsafe-type-assertion
		const completeCount = ((completeRes.data as { data?: unknown[] }).data ?? []).length;
		const progressRes = await api(
			session,
			"GET",
			`/api/events?entityId=${encodeURIComponent(entity.id)}&eventSchemaSlug=progress`,
		);
		// oxlint-disable-next-line no-unsafe-type-assertion
		const list =
			(progressRes.data as { data?: Array<{ properties: Record<string, unknown> }> }).data ?? [];
		const covered = new Set(
			list
				.filter((e) => e.properties.progressPercent === 100)
				.map((e) => `${e.properties.showSeason}-${e.properties.showEpisode}`),
		);
		return {
			completeCount,
			stored: list.length,
			missing: requiredKeys.filter((k) => !covered.has(k)),
		};
	};

	// First pass: post every episode. Then re-post any progress events that were
	// dropped by the before-trigger wait race, so coverage actually completes.
	await postKeys(requiredKeys);
	await waitForQueuesIdle();
	let state = await coverageState();
	let dropRounds = 0;
	let totalDropped = 0;
	while (state.completeCount === 0 && state.missing.length > 0 && dropRounds < 8) {
		dropRounds += 1;
		totalDropped += state.missing.length;
		console.log(
			`[retry ${dropRounds}] ${state.missing.length} dropped progress events (before-trigger wait race); re-posting ${JSON.stringify(state.missing.slice(0, 8))}${state.missing.length > 8 ? "…" : ""}`,
		);
		await postKeys(state.missing);
		await waitForQueuesIdle();
		state = await coverageState();
	}
	rmSync(SENTINEL, { force: true });
	const completeCount = state.completeCount;

	const samples = readSamples().filter((s) => s.ts >= runStart);
	const completion = samples.filter(
		(s) => s.ts >= completionStart && s.scriptSlug !== null && TRIGGER_SLUGS.has(s.scriptSlug),
	);
	const population = samples.filter((s) => !completion.includes(s));

	const lat = stats(postLatencies.map((v) => Math.round(v)));
	console.log(
		`\nposted ${postLatencies.length} progress events (${episodes.length} unique` +
			`${totalDropped > 0 ? `, ${totalDropped} re-posted after before-trigger-race drops` : ""}); ` +
			`complete events created = ${completeCount}`,
	);
	console.log(
		`event POST latency ms: p50=${lat.p50} p95=${lat.p95} mean=${lat.mean} max=${lat.max} (client-observed enqueue)`,
	);

	console.log(`\ntotal sandbox executions captured: ${samples.length}`);
	reportGroup("## Completion timeline scripts", completion);
	reportGroup("## Population / import scripts", population);

	await Promise.all([eventQueue.close(), sandboxQueue.close()]);
	process.exit(0);
}

await main();
