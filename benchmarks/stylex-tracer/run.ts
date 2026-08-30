/* oxlint-disable perfectionist/sort-objects, eslint/no-await-in-loop, oxc/no-map-spread, typescript/no-explicit-any, typescript/no-unsafe-type-assertion, typescript/require-await, unicorn/no-await-expression-member -- Sequential timing and report-shaped records are intentional. */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ClientCompilerBenchmarkEvidence } from "../../packages/client-plugin-compiler/src";
import type { Variant } from "./benchmark";
import { accountingInventory } from "./inventory";

const root = import.meta.dir;
const repositoryRoot = `${root}/../..`;
const resultsRoot = `${root}/results`;
const worker = `${root}/worker.ts`;
const alternatingWorker = `${root}/alternating-worker.ts`;
const boundaryWorker = `${root}/boundary-worker.ts`;
const variants = ["stylex", "tailwind"] as const;
const baselineCommit = "4c312ef838bf7bdc38896644f262869750f88d9d";
const historicalPreTracerCommit = "5228cc84a29d98283800f90b39434825a407f51a";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const round = (number: number) => Math.round(number * 100) / 100;

const command = (args: readonly string[], cwd = root) => {
	const result = Bun.spawnSync(args, { cwd, env: process.env, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) {
		throw new Error(decoder.decode(result.stderr) || `Command failed: ${args.join(" ")}`);
	}
	return {
		stdout: decoder.decode(result.stdout).trim(),
		stderr: decoder.decode(result.stderr).trim(),
	};
};
const value = (args: readonly string[]) => command(args, repositoryRoot).stdout;
const sha256 = (input: string | Uint8Array) => {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(typeof input === "string" ? encoder.encode(input) : input);
	return hasher.digest("hex");
};
const summary = (samples: readonly number[]) => {
	const ordered = [...samples].sort((left, right) => left - right);
	return {
		medianMs: ordered[Math.floor(ordered.length / 2)] ?? 0,
		minMs: ordered[0] ?? 0,
		maxMs: ordered.at(-1) ?? 0,
	};
};
const packageJson = async (name: string, owner = "packages/client-plugin-compiler") =>
	Bun.file(`${repositoryRoot}/${owner}/node_modules/${name}/package.json`).json();
const packageEvidence = async (name: string, owner?: string) => {
	const manifest = await packageJson(name, owner);
	return {
		name,
		version: manifest.version as string,
		immediateRuntimeDependencies: Object.keys(manifest.dependencies ?? {}).sort(),
	};
};

const timedWorker = (variant: Variant, mode: "cold" | "instrumented") => {
	const started = Bun.nanoseconds();
	const execution = command(["/usr/bin/time", "-l", process.execPath, worker, variant, mode]);
	const rssMatch = execution.stderr.match(/(\d+)\s+maximum resident set size/);
	return {
		wallMs: (Bun.nanoseconds() - started) / 1_000_000,
		peakRssBytes: rssMatch === null ? null : Number(rssMatch[1]),
		payload: JSON.parse(execution.stdout),
	};
};

const processSnapshot = () =>
	command(["ps", "-axo", "pid=,ppid=,rss=,comm="], repositoryRoot)
		.stdout.split("\n")
		.map((line) => /\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)/.exec(line))
		.flatMap((match) =>
			match
				? [
						{
							pid: Number(match[1]),
							ppid: Number(match[2]),
							rssBytes: Number(match[3]) * 1024,
							command: match[4],
						},
					]
				: [],
		);

const boundaryRun = async (variant: Variant, mode: "single" | "pair", temporaryRoot: string) => {
	const tracePath = `${temporaryRoot}/${variant}-${mode}.ndjson`;
	const child = Bun.spawn([process.execPath, boundaryWorker, variant, mode], {
		cwd: repositoryRoot,
		env: { ...process.env, RYOT_CLIENT_COMPILER_BENCHMARK_TRACE: tracePath },
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = new Response(child.stdout).text();
	const stderr = new Response(child.stderr).text();
	const peaks = new Map<number, { command: string; peakRssBytes: number }>();
	let sampledAggregatePeakRssBytes = 0;
	const poll = () => {
		const rows = processSnapshot();
		const included = new Set([child.pid]);
		let changed = true;
		while (changed) {
			changed = false;
			for (const row of rows) {
				if (included.has(row.ppid) && !included.has(row.pid)) {
					included.add(row.pid);
					changed = true;
				}
			}
		}
		let aggregate = 0;
		for (const row of rows.filter(({ pid }) => included.has(pid))) {
			aggregate += row.rssBytes;
			const current = peaks.get(row.pid);
			if (current === undefined || current.peakRssBytes < row.rssBytes) {
				peaks.set(row.pid, { command: row.command, peakRssBytes: row.rssBytes });
			}
		}
		sampledAggregatePeakRssBytes = Math.max(sampledAggregatePeakRssBytes, aggregate);
	};
	const timer = setInterval(poll, 5);
	poll();
	const exitCode = await child.exited;
	clearInterval(timer);
	poll();
	if (exitCode !== 0) {
		throw new Error((await stderr) || `Boundary worker exited ${exitCode}`);
	}
	const payload = JSON.parse(await stdout);
	const traces = (await Bun.file(tracePath).text())
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as ClientCompilerBenchmarkEvidence);
	const overlapMs =
		payload.builds.length === 2
			? Math.min(...payload.builds.map((build: any) => build.finishedMs)) -
				Math.max(...payload.builds.map((build: any) => build.startedMs))
			: null;
	if (
		traces.length !== payload.builds.length ||
		payload.builds.some((build: any) => !build.cssIsolation) ||
		(mode === "pair" && (payload.builds.length !== 2 || overlapMs === null || overlapMs <= 0))
	) {
		throw new Error(`${variant} ${mode} boundary evidence was incomplete`);
	}
	return {
		...payload,
		mode,
		overlapMs,
		orchestratorPid: child.pid,
		observedProcesses: [...peaks].map(([pid, observation]) => ({ pid, ...observation })),
		sampledAggregatePeakRssBytes,
		instrumentation: traces,
		rssCaveat:
			"5 ms ps samples can miss short-lived peaks. Aggregate RSS double-counts shared pages and is not proportional memory. macOS does not enforce the Linux /proc proportional-memory limit.",
	};
};

const measuredInventory = async () =>
	Promise.all(
		accountingInventory.map(async (item) => {
			const text = await Bun.file(`${repositoryRoot}/${item.path}`).text();
			const lines = text.split("\n").slice(item.lines[0] - 1, item.lines[1]);
			return {
				...item,
				measuredLines: lines.length,
				measuredBytes: encoder.encode(lines.join("\n")).byteLength,
			};
		}),
	);

const dirtyTreeManifest = async () => {
	const paths = value(["git", "status", "--porcelain=v1", "--untracked-files=all"])
		.split("\n")
		.filter(Boolean)
		.map((line) => line.slice(3).split(" -> ").at(-1) ?? "")
		.filter(
			(path) =>
				path !== "benchmarks/stylex-tracer/results/result.json" &&
				path !== "benchmarks/stylex-tracer/results/result.md",
		)
		.sort();
	const files = await Promise.all(
		paths.map(async (path) => {
			const file = Bun.file(`${repositoryRoot}/${path}`);
			if (!(await file.exists())) {
				return { path, state: "deleted" as const };
			}
			const contents = new Uint8Array(await file.arrayBuffer());
			return {
				path,
				state: "present" as const,
				bytes: contents.byteLength,
				sha256: sha256(contents),
			};
		}),
	);
	return { files, sha256: sha256(JSON.stringify(files)) };
};

const summarizeInstrumentation = (evidence: ClientCompilerBenchmarkEvidence) => {
	const topLevel = new Set([
		"input-validation",
		"original-source-preflight",
		"dependency-reads",
		"bundle",
		"typescript-check",
		"css-emission",
		"assets",
		"hashing-artifact",
	]);
	const total = evidence.spans.find(({ name }) => name === "compilation-total")?.durationMs ?? 0;
	const attributed = evidence.spans
		.filter(({ name }) => topLevel.has(name))
		.reduce((sum, { durationMs }) => sum + durationMs, 0);
	return {
		...evidence,
		spans: evidence.spans.map((span) => ({
			...span,
			label: span.inclusive ? "inclusive" : "exact",
		})),
		uninstrumentedResidualMs: Math.max(0, total - attributed),
		residualMeaning:
			"Compilation-total minus sequential top-level hooked spans. It includes generated-entry setup, reachability/limit checks, and other code without a hook. Nested inclusive spans are excluded from this subtraction.",
	};
};

const temporaryRoot = await mkdtemp(join(tmpdir(), "ryot-stylex-followup-benchmark-"));
try {
	const dirtyBefore = await dirtyTreeManifest();
	const lockfile = new Uint8Array(await Bun.file(`${repositoryRoot}/bun.lock`).arrayBuffer());
	const historical = JSON.parse(
		value(["git", "show", `${baselineCommit}:benchmarks/stylex-tracer/results/result.json`]),
	);
	const fresh: Record<string, ReturnType<typeof timedWorker>> = {};
	for (const variant of variants) {
		fresh[variant] = timedWorker(variant, "cold");
	}
	const alternatingStarted = Bun.nanoseconds();
	const alternatingExecution = command([
		"/usr/bin/time",
		"-l",
		process.execPath,
		alternatingWorker,
	]);
	const alternatingWallMs = (Bun.nanoseconds() - alternatingStarted) / 1_000_000;
	const alternating = JSON.parse(alternatingExecution.stdout);
	const alternatingRss = alternatingExecution.stderr.match(/(\d+)\s+maximum resident set size/);
	const instrumented = Object.fromEntries(
		variants.map((variant) => {
			const run = timedWorker(variant, "instrumented");
			return [
				variant,
				{
					wallMs: run.wallMs,
					peakRssBytes: run.peakRssBytes,
					importAndFingerprintMs: run.payload.importAndFingerprintMs,
					processToCompileReadyMs: run.payload.processToCompileReadyMs,
					artifactIdentity: run.payload.result.identity,
					instrumentation: summarizeInstrumentation(run.payload.result.benchmarkInstrumentation),
				},
			];
		}),
	);
	const concurrency: Record<string, unknown> = {};
	for (const variant of variants) {
		concurrency[variant] = {
			single: await boundaryRun(variant, "single", temporaryRoot),
			pair: await boundaryRun(variant, "pair", temporaryRoot),
		};
	}
	const inventory = await measuredInventory();
	const dirtyAfter = await dirtyTreeManifest();
	if (dirtyAfter.sha256 !== dirtyBefore.sha256) {
		throw new Error("Dirty-tree inputs changed during benchmark");
	}

	const measurements = Object.fromEntries(
		variants.map((variant) => {
			const samples = alternating.measured
				.filter((sample: any) => sample.variant === variant)
				.map((sample: any) => sample.result.compilationMs as number);
			const identities = alternating.measured
				.filter((sample: any) => sample.variant === variant)
				.map((sample: any) => sample.result.identity);
			const cold = fresh[variant];
			const artifact = cold.payload.result;
			if (
				samples.length < 5 ||
				new Set([artifact.identity, ...identities, instrumented[variant].artifactIdentity]).size !==
					1
			) {
				throw new Error(`${variant} timing or opt-in identity evidence was invalid`);
			}
			return [
				variant,
				{
					artifact,
					freshProcess: {
						wallMs: cold.wallMs,
						compilationMs: artifact.compilationMs,
						importAndFingerprintMs: cold.payload.importAndFingerprintMs,
						processToCompileReadyMs: cold.payload.processToCompileReadyMs,
						peakRssBytes: cold.peakRssBytes,
					},
					warmAlternating: { samplesMs: samples, ...summary(samples) },
					cache: {
						artifactCacheHits: 0,
						boundary:
							"Direct calls and supervised boundary calls always compile; no artifact repository is provided.",
					},
				},
			];
		}),
	);
	const dependencies = await Promise.all([
		packageEvidence("@stylexjs/stylex"),
		packageEvidence("@stylexjs/babel-plugin"),
		packageEvidence("@stylexjs/unplugin", "kernel/client"),
		packageEvidence("@babel/core"),
		packageEvidence("@babel/plugin-syntax-jsx"),
		packageEvidence("@babel/plugin-syntax-typescript"),
	]);
	const result = {
		schemaVersion: 4,
		status: "PASS",
		machine: {
			platform: process.platform,
			architecture: process.arch,
			osVersion: value(["sw_vers", "-productVersion"]),
			model: value(["sysctl", "-n", "hw.model"]),
			logicalCpuCount: Number(value(["sysctl", "-n", "hw.logicalcpu"])),
			memoryBytes: Number(value(["sysctl", "-n", "hw.memsize"])),
		},
		toolchain: {
			bun: Bun.version,
			bunRevision: Bun.revision,
			gitHead: value(["git", "rev-parse", "HEAD"]),
			baselineCommit,
			historicalPreTracerCommit,
			gitWorktreeDirty: value(["git", "status", "--porcelain"]).length > 0,
			lockfileSha256: sha256(lockfile),
			stylex: (await packageJson("@stylexjs/stylex")).version,
			stylexBabelPlugin: (await packageJson("@stylexjs/babel-plugin")).version,
			tailwindcss: (await packageJson("tailwindcss")).version,
		},
		method: {
			fixtureEquivalence:
				"Committed StyleX and benchmark-local Tailwind fixtures use graph application=page, production compiler options, two fonts, and one SVG.",
			freshProcess:
				"One uninstrumented fresh Bun process per variant. Process caches are empty; filesystem caches are not flushed.",
			warm: "One separate process imports once, discards one forced warmup per variant, then records five rounds. Round order alternates StyleX/Tailwind then Tailwind/StyleX.",
			instrumentation:
				"One separate opt-in fresh process per variant records only monotonic compiler hooks. Instrumented artifacts must match uninstrumented identities.",
			configuredBoundary:
				"Kernel ClientPluginCompiler.layer, semaphore concurrency=2, one supervised Bun --smol child per request, and one tsc semantic-check child per compiler worker; timeout=30000 ms and process-tree proportional-memory limit=1073741824 bytes where Linux /proc supervision is available.",
			freshRss:
				"/usr/bin/time -l maximum resident set size for the direct benchmark process. TypeScript checking runs in a child and is not included in that process high-water mark.",
			activation: { RYOT_STYLEX_TRACER: process.env.RYOT_STYLEX_TRACER ?? "unset" },
		},
		measurements,
		alternatingRun: {
			order: alternating.measured.map(({ round: roundNumber, order, variant }: any) => ({
				round: roundNumber,
				order,
				variant,
			})),
			processWallMs: alternatingWallMs,
			peakRssBytes: alternatingRss === null ? null : Number(alternatingRss[1]),
		},
		instrumented,
		concurrency,
		measuredInputEvidence: {
			graphInputs: Object.fromEntries(
				variants.map((variant) => {
					const input = (measurements as any)[variant].artifact.input;
					return [variant, { manifestSha256: input.manifestSha256, files: input.manifest }];
				}),
			),
			dirtyTree: dirtyBefore,
			dirtyTreeStableDuringMeasurement: true,
			note: "Graph manifests hash every contributor input byte. The dirty-tree manifest hashes every changed or untracked file except the two self-generated result files, including out-of-scope evidence that was observed but not modified.",
		},
		historicalResult: {
			sourceCommit: baselineCommit,
			machine: historical.machine,
			toolchain: historical.toolchain,
			measurements: historical.measurements,
			note: "Retained historical result. Do not treat differences across revisions, machines, fixture states, or toolchains as an isolated optimization.",
		},
		accounting: {
			status: "PASS",
			historicalAttributionBase: historicalPreTracerCommit,
			items: inventory,
			totals: Object.values(
				inventory.reduce<Record<string, { classification: string; lines: number; bytes: number }>>(
					(totals, item) => {
						const total = totals[item.classification] ?? {
							classification: item.classification,
							lines: 0,
							bytes: 0,
						};
						total.lines += item.measuredLines;
						total.bytes += item.measuredBytes;
						totals[item.classification] = total;
						return totals;
					},
					{},
				),
			),
			dependencies,
			note: "Ranges can overlap responsibilities and must not be summed as net integration size. The historical pre-tracer commit is the parent of the initial tracer commit. Excluded consumers still require Tailwind repository-wide.",
		},
		instrumentationGaps: [
			"Fresh import timing includes benchmark imports and dependency fingerprinting; those parts are not separately hooked.",
			"Dependency reads are one enclosing span; individual source, font, and package reads are not separately timed.",
			"The TypeScript span measures the parent waiting for semantic checking. TypeScript executes in a tsc child, so CPU and memory attribution remain unresolved.",
			"The bundle span is inclusive. Trusted reads/materialization, each StyleX transform, cleanup, and native Bun.build work occur inside it and cannot be added to it.",
			"Tailwind scanning and build are inside CSS emission but do not have separate timing hooks; StyleX rule processing is also inside CSS emission. Their exact attribution remains unresolved.",
			"Font reads occur in dependency reads. Asset emission and hashing/artifact construction are timed, but finer attribution within each span remains unresolved.",
		],
		limitations: [
			"Filesystem caches were not flushed; thermal state and background load are uncontrolled.",
			"Process RSS does not establish per-library allocation cost; /usr/bin/time and sampled process-tree aggregates use different boundaries.",
			"macOS ps aggregate RSS can double-count shared pages, is sampled, and does not provide the Linux proportional-memory supervision used by production.",
			"The fixture is small and does not predict product-screen or whole-application cost.",
			"No optimization was made.",
		],
	};

	const measurementRows = variants.map((variant) => {
		const entry = (measurements as any)[variant];
		const sizes = entry.artifact.sizes;
		return `| ${variant === "stylex" ? "StyleX" : "Tailwind"} | ${sizes.javascript.rawBytes} / ${sizes.javascript.gzipBytes} | ${sizes.css.rawBytes} / ${sizes.css.gzipBytes} | ${sizes.javascriptAndCss.rawBytes} / ${sizes.javascriptAndCss.gzipBytes} | ${sizes.fontAssets.rawBytes} (${sizes.fontAssets.count}) | ${sizes.localAssets.rawBytes} (${sizes.localAssets.count}) | ${sizes.fullArtifactBytes} | ${round(entry.freshProcess.wallMs)} | ${entry.warmAlternating.samplesMs.map(round).join(", ")} | ${round(entry.warmAlternating.medianMs)} [${round(entry.warmAlternating.minMs)}, ${round(entry.warmAlternating.maxMs)}] | ${entry.freshProcess.peakRssBytes ?? "unavailable"} |`;
	});
	const spanRows = variants.flatMap((variant) => {
		const evidence = result.instrumented[variant].instrumentation;
		return [
			...evidence.spans.map(
				(span: any) => `| ${variant} | ${span.name} | ${round(span.durationMs)} | ${span.label} |`,
			),
			`| ${variant} | uninstrumented residual | ${round(evidence.uninstrumentedResidualMs)} | unresolved |`,
		];
	});
	const concurrencyRows = variants.map((variant) => {
		const entry = result.concurrency[variant] as any;
		return `| ${variant} | ${round(entry.single.pairWallMs)} | ${round(entry.pair.pairWallMs)} | ${round(entry.pair.overlapMs)} | ${entry.pair.builds.every((build: any) => build.cssIsolation)} | ${entry.single.sampledAggregatePeakRssBytes} / ${entry.pair.sampledAggregatePeakRssBytes} | ${entry.pair.observedProcesses.length} |`;
	});
	const inventoryRows = inventory.map(
		(item) =>
			`| ${item.classification} | \`${item.path}:${item.lines[0]}-${item.lines[1]}\` | \`${item.symbol}\` | ${item.measuredLines} / ${item.measuredBytes} | ${item.responsibility} | ${item.disposition} |`,
	);
	const markdown = `# StyleX tracer follow-up benchmark result

Status: **PASS** with attribution caveats. No optimization was made.

## Environment

- HEAD: \`${result.toolchain.gitHead}\`; requested baseline: \`${baselineCommit}\`; historical pre-tracer parent: \`${historicalPreTracerCommit}\`
- Machine: ${result.machine.model}, ${result.machine.architecture}, ${result.machine.logicalCpuCount} logical CPUs, ${result.machine.memoryBytes} bytes; macOS ${result.machine.osVersion}
- Bun ${result.toolchain.bun} (${result.toolchain.bunRevision}), StyleX ${result.toolchain.stylex}, Babel plugin ${result.toolchain.stylexBabelPlugin}, Tailwind CSS ${result.toolchain.tailwindcss}
- Lockfile SHA-256: \`${result.toolchain.lockfileSha256}\`; worktree dirty: ${result.toolchain.gitWorktreeDirty}; activation: ${result.method.activation.RYOT_STYLEX_TRACER}
- Dirty-tree manifest SHA-256: \`${result.measuredInputEvidence.dirtyTree.sha256}\`; stable during measurement: ${result.measuredInputEvidence.dirtyTreeStableDuringMeasurement}. Exact paths and hashes are in JSON.

## Uninstrumented Totals

| Variant | JS raw / gzip B | CSS raw / gzip B | JS+CSS raw / gzip B | Fonts B (files) | Local assets B (files) | Full artifact B | Fresh-process wall ms | Warm forced compile samples ms | Median [min, max] ms | Fresh peak RSS B |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
${measurementRows.join("\n")}

One uninstrumented fresh process was used per variant. One separate warm process discarded one warmup per variant, then measured five alternating rounds. Cache hits were zero. Fresh means process-cold, not filesystem-cold. Exact graph-input file hashes are in JSON. The historical first-tracer result is retained in JSON and is not compared as an isolated improvement because its revision, fixture state, and toolchain differ.

## Exact Instrumentation

| Variant | Span | Monotonic ms | Attribution |
| --- | --- | ---: | --- |
${spanRows.join("\n")}

These values come only from current opt-in hooks. Inclusive spans overlap their nested spans: bundling includes trusted reads/materialization, StyleX transforms, cleanup, and native Bun work; compilation-total includes all compiler spans. The residual subtracts only sequential top-level spans. Instrumented and uninstrumented artifact identities matched. Remaining attribution is listed below and not estimated from CPU samples.

## Configured Concurrency

| Variant | Single boundary wall ms | Two-build boundary wall ms | Observed overlap ms | CSS isolated | Single / pair sampled aggregate peak RSS B | Pair observed process count |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
${concurrencyRows.join("\n")}

This uses the actual kernel \`ClientPluginCompiler.layer\`: semaphore limit 2, one supervised \`bun --smol\` child per request, and one \`tsc\` semantic-check child per compiler worker. Pair inputs are distinct and uncached. Worker hook records and process topology are in JSON. The 5 ms \`ps\` aggregate can miss peaks and double-count shared pages. macOS cannot exercise Linux \`/proc\` proportional-memory enforcement.

## Permanent-Cost Inventory

| Classification | Source | Symbol | Lines / bytes | Responsibility | Proposed disposition |
| --- | --- | --- | ---: | --- | --- |
${inventoryRows.join("\n")}

Ranges are source-backed responsibility slices, not a net line-count score. Mixed responsibilities and overlaps must not be summed. Dependency implications and classification totals are in JSON. Tailwind remains required by excluded repository consumers.

## Unresolved Attribution

${result.instrumentationGaps.map((item) => `- ${item}`).join("\n")}

## Caveats

${result.limitations.map((item) => `- ${item}`).join("\n")}
`;

	await mkdir(resultsRoot, { recursive: true });
	await Bun.write(`${resultsRoot}/result.json`, `${JSON.stringify(result, null, 2)}\n`);
	await Bun.write(`${resultsRoot}/result.md`, markdown);
	command([
		`${repositoryRoot}/node_modules/.bin/oxfmt`,
		`${resultsRoot}/result.json`,
		`${resultsRoot}/result.md`,
		"--write",
	]);
	console.log(`${resultsRoot}/result.json`);
	console.log(`${resultsRoot}/result.md`);
} finally {
	await rm(temporaryRoot, { recursive: true, force: true });
}
