import { readFileSync } from "node:fs";

const [mode, workload, nArg, concArg, heapArg, cpuArg, abArg, laneArg] = process.argv.slice(2);
const LANE = laneArg ?? "interactive";
const N = Number(nArg ?? 20);
const CONC = Number(concArg ?? 1);
const HEAP_MIB = Number(heapArg ?? 64);
const CPU_MS = Number(cpuArg ?? 10_000);
const AB_MIB = Number(abArg ?? 128);
const HOST_DELAY_MS = 25;
const ROOT = "/root/spike";
const code = readFileSync(`${ROOT}/workloads/${workload}.mjs`, "utf8");
const inputFor = (i: number) => JSON.stringify({ i, secret: `secret-${i}` });

const memUsedMiB = () => {
	const m = Object.fromEntries(readFileSync("/proc/meminfo", "utf8").trim().split("\n").map((l) => { const [k, v] = l.split(/:\s+/); return [k, Number.parseInt(v)]; }));
	return (m.MemTotal - m.MemAvailable) / 1024;
};
const rssMiB = (pid: number) => { try { const m = readFileSync(`/proc/${pid}/status`, "utf8").match(/VmRSS:\s+(\d+)/); return m ? Number(m[1]) / 1024 : 0; } catch { return 0; } };
const cpuJiffies = (pid: number) => { try { const f = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" "); return Number(f[11]) + Number(f[12]); } catch { return 0; } };
const sysBusyJiffies = () => { const f = readFileSync("/proc/stat", "utf8").split("\n")[0].trim().split(/\s+/).slice(1).map(Number); return f.reduce((a, b) => a + b, 0) - f[3] - f[4]; };
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN; };
const r1 = (x: number) => Math.round(x * 10) / 10;

const idleMem = memUsedMiB();
let memPeak = 0;
let procPeak = 0;
const livePids = new Set<number>();
let sidecarPid = 0;
const sampler = setInterval(() => {
	memPeak = Math.max(memPeak, memUsedMiB() - idleMem);
	const p = sidecarPid ? rssMiB(sidecarPid) : [...livePids].reduce((a, pid) => a + rssMiB(pid), 0);
	procPeak = Math.max(procPeak, p);
}, 50);

type Done = { latencyMs: number; kind: string; result?: any; error?: string; createMs?: number; cpuMs?: number; heapUsed?: number; maxRssMiB?: number };
const results: Done[] = [];

async function runSidecar() {
	sidecarPid = Number(readFileSync(`${ROOT}/sidecar.pid`, "utf8"));
	const cpu0 = cpuJiffies(sidecarPid);
	const waiters = new Map<number, (d: any) => void>();
	let buf = "";
	let pendingOut = Buffer.alloc(0);
	const flush = (sock: any) => {
		while (pendingOut.length > 0) {
			const n = sock.write(pendingOut);
			if (n <= 0) return;
			pendingOut = pendingOut.subarray(n);
		}
	};
	const send = (sock: any, line: string) => {
		pendingOut = Buffer.concat([pendingOut, Buffer.from(line + "\n")]);
		flush(sock);
	};
	const socket = await Bun.connect({
		unix: `${ROOT}/sidecar.sock`,
		socket: {
			drain(sock) {
				flush(sock);
			},
			data(sock, data) {
				buf += data.toString();
				let i;
				while ((i = buf.indexOf("\n")) >= 0) {
					const m = JSON.parse(buf.slice(0, i));
					buf = buf.slice(i + 1);
					if (m.t === "call") setTimeout(() => send(sock, JSON.stringify({ t: "res", id: m.id, call: m.call, ok: true, value: JSON.stringify({ n: 1, name: m.name }) })), HOST_DELAY_MS);
					else if (m.t === "done") waiters.get(m.id)?.(m);
				}
			},
		},
	});
	let nextId = 0;
	const one = async () => {
		const id = ++nextId;
		const t0 = performance.now();
		const d: any = await new Promise((resolve) => { waiters.set(id, resolve); send(socket, JSON.stringify({ t: "run", id, spec: `${workload}-${id}`, code, input: inputFor(id), heap_mib: HEAP_MIB, cpu_ms: CPU_MS, ab_mib: AB_MIB, lane: LANE })); });
		results.push({ latencyMs: performance.now() - t0, kind: d.kind, result: d.result ? JSON.parse(d.result) : undefined, error: d.error, createMs: d.createMs, cpuMs: d.cpuMs, heapUsed: d.heapUsed });
	};
	await pool(one);
	socket.end();
	return (cpuJiffies(sidecarPid) - cpu0) * 10;
}

async function runDeno() {
	let cpuTotal = 0;
	const one = async () => {
		const t0 = performance.now();
		const child = Bun.spawn([
			"deno", "run", "--deny-run", "--deny-env", "--deny-ffi", "--deny-write", "--no-prompt", "--no-config", "--no-lock", "--no-npm", "--no-remote", "--cached-only",
			"--v8-flags=--max-old-space-size=256", `--import-map=${ROOT}/runtime/import-map.json`, `--allow-read=${ROOT}/runtime,${ROOT}/workloads`, "--allow-net=127.0.0.1:1",
			`${ROOT}/workloads/deno-harness.mjs`, `${ROOT}/workloads/${workload}.mjs`,
		], { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH!, DENO_DIR: `${ROOT}/deno-cache` } });
		livePids.add(child.pid);
		const kill = setTimeout(() => child.kill(9), 15_000);
		child.stdin.write(JSON.stringify({ t: "input", input: inputFor(0) }) + "\n");
		child.stdin.flush();
		let done: any;
		let buf = "";
		const dec = new TextDecoder();
		for await (const chunk of child.stdout) {
			buf += dec.decode(chunk, { stream: true });
			let i;
			while ((i = buf.indexOf("\n")) >= 0) {
				const m = JSON.parse(buf.slice(0, i));
				buf = buf.slice(i + 1);
				if (m.t === "call") setTimeout(() => { child.stdin.write(JSON.stringify({ t: "res", call: m.call, ok: true, value: JSON.stringify({ n: 1 }) }) + "\n"); child.stdin.flush(); }, HOST_DELAY_MS);
				else if (m.t === "done") done = m;
			}
		}
		const exit = await child.exited;
		clearTimeout(kill);
		livePids.delete(child.pid);
		const usage = child.resourceUsage();
		const cpuMs = usage ? Number(usage.cpuTime.total) / 1000 : 0;
		cpuTotal += cpuMs;
		const result = done ? JSON.parse(done.result) : undefined;
		const stderr = await new Response(child.stderr).text();
		results.push({ latencyMs: performance.now() - t0, kind: !done ? (exit === 137 || child.signalCode ? "killed" : `crashed(${exit})`) : result.ok ? "ok" : "script-error", result, error: done ? undefined : stderr.slice(-300), cpuMs, maxRssMiB: usage ? usage.maxRSS / 1048576 : 0 });
	};
	await pool(one);
	return cpuTotal;
}

async function pool(one: () => Promise<void>) {
	let started = 0;
	const lane = async () => { while (started < N) { started++; await one(); } };
	await Promise.all(Array.from({ length: CONC }, lane));
}

const sys0 = sysBusyJiffies();
const t0 = performance.now();
const runtimeCpuMs = mode === "sidecar" ? await runSidecar() : await runDeno();
const wallMs = performance.now() - t0;
clearInterval(sampler);
const lat = results.map((r) => r.latencyMs);
const kinds: Record<string, number> = {};
for (const r of results) kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
const ok = results.filter((r) => r.result?.ok);
console.log(JSON.stringify({
	mode, workload, n: N, conc: CONC, kinds,
	wallS: r1(wallMs / 1000), perMin: r1((N / wallMs) * 60_000),
	latP50: r1(pct(lat, 50)), latP95: r1(pct(lat, 95)), latMax: r1(Math.max(...lat)),
	loadP50: r1(pct(ok.map((r) => r.result.loadMs), 50)), runP50: r1(pct(ok.map((r) => r.result.runMs), 50)),
	createP50: mode === "sidecar" ? r1(pct(results.map((r) => r.createMs!), 50)) : undefined,
	runtimeCpuMsPerExec: r1(runtimeCpuMs / N), sysCpuS: r1((sysBusyJiffies() - sys0) / 100),
	procRssPeakMiB: r1(procPeak), sysMemPeakDeltaMiB: r1(memPeak),
	perProcMaxRssP50MiB: mode === "deno" ? r1(pct(results.map((r) => r.maxRssMiB!), 50)) : undefined,
	heapUsedP50MiB: mode === "sidecar" ? r1(pct(results.map((r) => r.heapUsed! / 1048576), 50)) : undefined,
	sample: results[0]?.result?.value ?? results[0]?.result?.error?.slice(0, 400) ?? results[0]?.error,
}));
process.exit(0);
