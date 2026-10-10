import { readFileSync } from "node:fs";

const [bgLane, fgN, fgConc, bgN, bgConc] = [process.argv[2] ?? "interactive", 100, 2, 40, 4];
const ROOT = "/root/spike";
const code = (w: string) => readFileSync(`${ROOT}/workloads/${w}.mjs`, "utf8");
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const r1 = (x: number) => Math.round(x * 10) / 10;

const waiters = new Map<number, (d: any) => void>();
let buf = "";
let out = Buffer.alloc(0);
const flush = (sock: any) => { while (out.length > 0) { const n = sock.write(out); if (n <= 0) return; out = out.subarray(n); } };
const send = (sock: any, line: string) => { out = Buffer.concat([out, Buffer.from(line + "\n")]); flush(sock); };
const socket = await Bun.connect({
	unix: `${ROOT}/sidecar.sock`,
	socket: {
		drain: flush,
		data(sock, data) {
			buf += data.toString();
			let i;
			while ((i = buf.indexOf("\n")) >= 0) {
				const m = JSON.parse(buf.slice(0, i));
				buf = buf.slice(i + 1);
				if (m.t === "call") setTimeout(() => send(sock, JSON.stringify({ t: "res", id: m.id, call: m.call, ok: true, value: JSON.stringify({ n: 1 }) })), 25);
				else if (m.t === "done") waiters.get(m.id)?.(m);
			}
		},
	},
});

let nextId = 0;
const run = (workload: string, lane: string) => {
	const id = ++nextId;
	const t0 = performance.now();
	return new Promise<{ ms: number; kind: string }>((resolve) => {
		waiters.set(id, (d) => resolve({ ms: performance.now() - t0, kind: d.kind }));
		send(socket, JSON.stringify({ t: "run", id, spec: `${workload}-${id}`, code: code(workload), input: "{}", heap_mib: 256, cpu_ms: 30000, ab_mib: 256, lane }));
	});
};
const pool = async (n: number, conc: number, one: () => Promise<{ ms: number; kind: string }>) => {
	const res: { ms: number; kind: string }[] = [];
	let started = 0;
	await Promise.all(Array.from({ length: conc }, async () => { while (started < n) { started++; res.push(await one()); } }));
	return res;
};

const bgStart = performance.now();
const bgP = pool(bgN, bgConc, () => run("cpu", bgLane));
await Bun.sleep(1500);
const fg = await pool(fgN, fgConc, () => run("host5", "interactive"));
const fgDoneAt = performance.now() - bgStart;
const bg = await bgP;
const bgDoneAt = performance.now() - bgStart;
const fgMs = fg.map((r) => r.ms);
console.log(JSON.stringify({
	bgLane,
	overlap: fgDoneAt < bgDoneAt,
	fgDoneAtS: r1(fgDoneAt / 1000), bgDoneAtS: r1(bgDoneAt / 1000),
	fgOk: fg.filter((r) => r.kind === "ok").length, bgOk: bg.filter((r) => r.kind === "ok").length,
	fgP50: r1(pct(fgMs, 50)), fgP95: r1(pct(fgMs, 95)), fgMax: r1(Math.max(...fgMs)),
	bgP50: r1(pct(bg.map((r) => r.ms), 50)),
}));
socket.end();
process.exit(0);
