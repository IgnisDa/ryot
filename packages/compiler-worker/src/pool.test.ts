import { expect } from "bun:test";

import { BunServices } from "@effect/platform-bun";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, FileSystem, Path } from "effect";

import { type CompilerWorkerPoolOptions, makeCompilerWorkerPool } from "./pool";

const workerPath = Bun.fileURLToPath(new URL("./test-fixtures/worker.ts", import.meta.url));

const makePool = (options: Partial<CompilerWorkerPoolOptions<string>> = {}) =>
	makeCompilerWorkerPool({
		size: 1,
		env: {},
		path: workerPath,
		cpuTimeMs: 5_000,
		timeoutMs: 10_000,
		outputBytes: 1_000,
		idleTimeoutMs: 60_000,
		label: "test-compiler",
		memoryPollIntervalMs: 5,
		startupTimeoutMs: 20_000,
		memoryBytes: 2 * 1024 ** 3,
		jobFailure: (failure) => failure,
		recycleMemoryBytes: 2 * 1024 ** 3,
		goMemoryLimitBytes: 256 * 1024 ** 2,
		...options,
	});

const request = (line: string) => () => Effect.succeed(line);

layer(BunServices.layer, { excludeTestServices: true })((test) => {
	test.effect(
		"serves consecutive jobs from one warm worker with its Go memory limit",
		() =>
			Effect.gen(function* () {
				const pool = yield* makePool();
				const first = yield* pool.run(request("pid"));

				expect(yield* pool.run(request("pid"))).toBe(first);
				expect(yield* pool.run(request("env:GOMEMLIMIT"))).toBe(String(256 * 1024 ** 2));
			}).pipe(Effect.scoped),
		testTimeout,
	);

	test.effect(
		"fails a job over its CPU budget and serves the next job from a fresh worker",
		() =>
			Effect.gen(function* () {
				const pool = yield* makePool({ cpuTimeMs: 300 });
				const first = yield* pool.run(request("pid"));

				expect(yield* pool.run(request("spin:5000")).pipe(Effect.flip)).toBe("CpuTimeExceeded");
				expect(yield* pool.run(request("pid"))).not.toBe(first);
			}).pipe(Effect.scoped),
		testTimeout,
	);

	test.effect(
		"reports a job past the elapsed-time limit as unavailable and recovers",
		() =>
			Effect.gen(function* () {
				const pool = yield* makePool({ timeoutMs: 300 });
				const first = yield* pool.run(request("pid"));

				const failure = yield* pool.run(request("sleep:5000")).pipe(Effect.flip);
				expect(failure).toMatchObject({ _tag: "CompilerWorkerUnavailable" });
				expect(yield* pool.run(request("pid"))).not.toBe(first);
			}).pipe(Effect.scoped),
		testTimeout,
	);

	test.effect(
		"reports a worker that exits mid-job as unavailable and recovers",
		() =>
			Effect.gen(function* () {
				const pool = yield* makePool();

				const failure = yield* pool.run(request("exit")).pipe(Effect.flip);
				expect(failure).toMatchObject({ _tag: "CompilerWorkerUnavailable" });
				expect(yield* pool.run(request("pid"))).toMatch(/^\d+$/);
			}).pipe(Effect.scoped),
		testTimeout,
	);

	test.effect(
		"fails a job whose response exceeds the output limit",
		() =>
			Effect.gen(function* () {
				const pool = yield* makePool();

				expect(yield* pool.run(request("large:2000")).pipe(Effect.flip)).toBe("OutputExceeded");
				expect(yield* pool.run(request("large:10"))).toBe("x".repeat(10));
			}).pipe(Effect.scoped),
		testTimeout,
	);

	test.effect(
		"reports a worker that cannot warm up as unavailable",
		() =>
			Effect.gen(function* () {
				const pool = yield* makePool({ verifyEnvironment: true });

				const failure = yield* pool.run(request("pid")).pipe(Effect.flip);
				expect(failure).toMatchObject({ _tag: "CompilerWorkerUnavailable" });
			}).pipe(Effect.scoped),
		testTimeout,
	);

	test.effect(
		"removes each job workspace after the job",
		() =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const directory = yield* fs.makeTempDirectoryScoped({ prefix: "compiler-worker-test-" });
				const pool = yield* makePool({ workspaceDirectory: directory });
				let workspace = "";

				const staged = yield* pool.run((job) => {
					workspace = path.join(job.parentPath, job.jobId);
					return Effect.succeed(`workspace:${workspace}`);
				});
				expect(staged).toBe("staged");
				expect(yield* fs.exists(workspace)).toBe(false);
			}).pipe(Effect.scoped),
		testTimeout,
	);

	test.effect(
		"retires a worker after its idle timeout",
		() =>
			Effect.gen(function* () {
				const pool = yield* makePool({ idleTimeoutMs: 100 });
				const first = yield* pool.run(request("pid"));
				yield* Effect.sleep(500);

				expect(yield* pool.run(request("pid"))).not.toBe(first);
			}).pipe(Effect.scoped),
		testTimeout,
	);
});
