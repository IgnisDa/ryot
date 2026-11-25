import { type Duration, Effect } from "effect";

export const captureTestProcess = Effect.fn(function* (options: {
	readonly cwd?: string;
	readonly args: ReadonlyArray<string>;
	readonly env?: Readonly<Record<string, string>>;
}) {
	return yield* Effect.scoped(
		Effect.gen(function* () {
			const child = yield* Effect.acquireRelease(
				Effect.sync(() =>
					Bun.spawn([process.execPath, "--no-orphans", ...options.args], {
						stdout: "pipe",
						stderr: "pipe",
						stdin: "ignore",
						...(options.cwd === undefined ? {} : { cwd: options.cwd }),
						env: { ...process.env, ...options.env },
					}),
				),
				(running) =>
					Effect.gen(function* () {
						if (running.exitCode === null) {
							running.kill();
						}
						yield* Effect.promise(() => running.exited);
					}),
			);
			const [exitCode, stdout, stderr] = yield* Effect.all(
				[
					Effect.promise(() => child.exited),
					Effect.promise(() => new Response(child.stdout).text()),
					Effect.promise(() => new Response(child.stderr).text()),
				],
				{ concurrency: 3 },
			);
			return { exitCode, output: stdout + stderr };
		}),
	);
});

export const stopTestProcess = (
	process: undefined | Pick<Bun.Subprocess, "kill" | "exited" | "exitCode">,
	gracePeriod: Duration.Input = "20 seconds",
) =>
	Effect.gen(function* () {
		if (process?.exitCode !== null) {
			return;
		}
		process.kill("SIGINT");
		const exited = yield* Effect.promise(() => process.exited).pipe(
			Effect.timeoutOption(gracePeriod),
		);
		if (exited._tag === "Some") {
			return;
		}
		process.kill("SIGKILL");
		yield* Effect.promise(() => process.exited);
	});
