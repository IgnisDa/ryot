const probe = async (name, fn) => { try { const v = await fn(); return [name, "ALLOWED", String(v).slice(0, 80)]; } catch (e) { return [name, "blocked", String(e?.message ?? e).slice(0, 80)]; } };
export default async () => Object.fromEntries((await Promise.all([
	probe("Deno global", () => { if (typeof Deno === "undefined") throw new Error("undefined"); return Object.keys(Deno); }),
	probe("eval", () => eval("1+1")),
	probe("Function ctor", () => new Function("return 1")()),
	probe("ctor chain", () => (() => {}).constructor("return globalThis")()),
	probe("import file", () => import("file:///etc/passwd")),
	probe("import runtime file directly", () => import("file:///runtime/effect-4.0.0.mjs").then((m) => Object.keys(m).length)),
	probe("import remote", () => import("https://example.com/x.js")),
	probe("fetch", () => fetch("https://example.com")),
	probe("WebAssembly", () => typeof WebAssembly.compile),
	probe("SharedArrayBuffer", () => new SharedArrayBuffer(8).byteLength),
	probe("__ryot_start", () => typeof globalThis.__ryot_start === "function" ? globalThis.__ryot_start("x") : (() => { throw new Error("gone"); })()),
	probe("__bootstrap", () => { if (typeof __bootstrap === "undefined") throw new Error("undefined"); return 1; }),
	probe("Date.now", () => Date.now()),
	probe("Math.random", () => Math.random()),
])).map(([n, s, d]) => [n, `${s}: ${d}`]));
