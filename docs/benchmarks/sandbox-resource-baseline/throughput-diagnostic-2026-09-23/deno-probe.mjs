import { writeFileSync } from "node:fs";
const rows = [];
for (let round = 0; round < 16; round++) {
	for (const target of round % 2 === 0
		? ["bare", "effect", "runner"]
		: ["runner", "effect", "bare"]) {
		for (const version of round % 2 === 0 ? ["116", "117"] : ["117", "116"]) {
			const root = `${process.env.DIAGNOSTIC_DENO_ROOT ?? "/home/ryot/tmp/deno-v"}${version}`;
			const module =
				target === "runner" ? `${root}/runner.mjs` : `${root}/effect-4.0.0-rc.${version}.mjs`;
			const code = `const exit = Deno.exit; const emit = console.log.bind(console); const start = performance.now(); ${target === "bare" ? "" : `await import(${JSON.stringify(module)});`} emit(JSON.stringify({ importMs: performance.now() - start })); exit(0);`;
			writeFileSync(`${root}/probe-${target}.mjs`, code);
			const started = performance.now();
			const child = Bun.spawn(
				[
					"deno",
					"run",
					"--deny-run",
					"--deny-env",
					"--deny-ffi",
					"--deny-write",
					"--no-prompt",
					"--no-config",
					"--no-lock",
					"--cached-only",
					"--no-npm",
					"--no-remote",
					`--allow-read=${root}`,
					"--allow-net=127.0.0.1:1",
					`--import-map=${root}/import-map.json`,
					"--v8-flags=--max-old-space-size=256",
					`${root}/probe-${target}.mjs`,
				],
				{
					stdin: "pipe",
					stdout: "pipe",
					stderr: "pipe",
					env: { PATH: process.env.PATH, DENO_DIR: `${root}/cache` },
				},
			);
			const reader = child.stdout.getReader();
			let stdout = "";
			while (!stdout.includes("\n")) {
				const chunk = await reader.read();
				if (chunk.done) break;
				stdout += new TextDecoder().decode(chunk.value);
			}
			const readyMs = performance.now() - started;
			const [stderr, exit] = await Promise.all([new Response(child.stderr).text(), child.exited]);
			if (exit !== 0) throw new Error(stderr);
			rows.push({
				round,
				target,
				version,
				readyMs,
				wallMs: performance.now() - started,
				...JSON.parse(stdout),
			});
		}
	}
}
writeFileSync(
	process.env.DIAGNOSTIC_RESULT ?? "/tmp/throughput-deno-comparison-run.json",
	JSON.stringify({ bun: Bun.version, rows }, null, 2),
	{ mode: 0o600 },
);
const median = (a) => a.sort((a, b) => a - b)[Math.floor(a.length / 2)];
for (const version of ["116", "117"])
	for (const target of ["bare", "effect", "runner"]) {
		const a = rows.filter((r) => r.round > 0 && r.version === version && r.target === target);
		console.log(
			JSON.stringify({
				version,
				target,
				n: a.length,
				readyP50Ms: median(a.map((r) => r.readyMs)),
				wallP50Ms: median(a.map((r) => r.wallMs)),
				importP50Ms: median(a.map((r) => r.importMs)),
			}),
		);
	}
