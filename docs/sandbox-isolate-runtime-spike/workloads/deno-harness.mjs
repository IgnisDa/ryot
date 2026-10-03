const enc = new TextEncoder();
const dec = new TextDecoder();
const out = (o) => Deno.stdout.writeSync(enc.encode(JSON.stringify(o) + "\n"));
const pending = new Map();
let next = 0;
let buf = "";
let inputResolve;
const input = new Promise((r) => (inputResolve = r));
(async () => {
	for await (const chunk of Deno.stdin.readable) {
		buf += dec.decode(chunk, { stream: true });
		let i;
		while ((i = buf.indexOf("\n")) >= 0) {
			const m = JSON.parse(buf.slice(0, i));
			buf = buf.slice(i + 1);
			if (m.t === "input") inputResolve(m.input);
			else {
				const p = pending.get(m.call);
				pending.delete(m.call);
				m.ok ? p.resolve(m.value) : p.reject(new Error(m.value));
			}
		}
	}
})();
const host = {
	call: (name, args) =>
		new Promise((resolve, reject) => {
			const call = ++next;
			pending.set(call, { resolve: (v) => resolve(JSON.parse(v)), reject });
			out({ t: "call", call, name, args: JSON.stringify(args ?? null) });
		}),
};
const t0 = performance.now();
try {
	const mod = await import(Deno.args[0]);
	const t1 = performance.now();
	const value = await mod.default(JSON.parse(await input), host);
	out({ t: "done", result: JSON.stringify({ ok: true, value: value ?? null, loadMs: t1 - t0, runMs: performance.now() - t1 }) });
} catch (e) {
	out({ t: "done", result: JSON.stringify({ ok: false, error: String(e?.stack ?? e) }) });
}
Deno.exit(0);
