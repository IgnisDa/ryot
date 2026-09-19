import { assert, describe, expect, it, layer } from "@effect/vitest";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Cause, Deferred, Effect, Exit, Fiber, Option, Result, Sink, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { makeAppConfigLayer } from "#lib/test-utils/effect";

import { MiB } from "./sandbox-runtime/limits";
import { runSplitSupervisor, splitMemoryBudget, SplitSupervisorError } from "./split-supervisor";

const entry = { executable: "/usr/bin/bun", args: ["/app/dist/main.js"] };

type Started = {
	readonly role: string;
	readonly command: string;
	readonly args: ReadonlyArray<string>;
	readonly options: ChildProcess.CommandOptions;
};

const makeSpawner = (exitsAfterStart: Readonly<Record<string, number>> = {}) => {
	const started: Array<Started> = [];
	const killed: Array<string> = [];
	const spawner = ChildProcessSpawner.make((command) =>
		Effect.gen(function* () {
			assert(ChildProcess.isStandardCommand(command));
			const env = command.options.env;
			const role =
				env?.["RUN_MIGRATION_ONLY"] === "true" ? "migration" : (env?.["SERVER_LANES"] ?? "");
			started.push({
				role,
				args: command.args,
				command: command.command,
				options: command.options,
			});
			const exit = yield* Deferred.make<ChildProcessSpawner.ExitCode>();
			const configuredExit = exitsAfterStart[role] ?? (role === "migration" ? 0 : undefined);
			if (configuredExit !== undefined) {
				yield* Deferred.succeed(exit, ChildProcessSpawner.ExitCode(configuredExit));
			}
			return ChildProcessSpawner.makeHandle({
				all: Stream.empty,
				stdin: Sink.drain,
				stderr: Stream.empty,
				stdout: Stream.empty,
				getInputFd: () => Sink.drain,
				exitCode: Deferred.await(exit),
				getOutputFd: () => Stream.empty,
				unref: Effect.succeed(Effect.void),
				pid: ChildProcessSpawner.ProcessId(1),
				isRunning: Effect.map(Deferred.isDone(exit), (done) => !done),
				kill: () =>
					Effect.sync(() => killed.push(role)).pipe(
						Effect.andThen(Deferred.succeed(exit, ChildProcessSpawner.ExitCode(143))),
						Effect.asVoid,
					),
			});
		}),
	);
	return { killed, spawner, started };
};

const supervise = (spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]) =>
	runSplitSupervisor({ entry, effectiveMemory: 8192 * MiB }).pipe(
		Effect.scoped,
		Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
	);

const configured = (memoryBudgetMiB: number) =>
	makeAppConfigLayer({ sandbox: { memoryBudgetMiB: Option.some(memoryBudgetMiB) } });

layer(configured(1904))("split supervisor", (test) => {
	test.effect("runs migrations first and then starts both roles with their own environment", () =>
		Effect.gen(function* () {
			const { spawner, started } = makeSpawner({ background: 0 });
			yield* supervise(spawner);

			expect(started.map(({ role }) => role)).toEqual(["migration", "interactive", "background"]);
			const [migration, interactive, background] = started;
			assert(migration !== undefined && interactive !== undefined && background !== undefined);
			expect([migration.command, migration.args, migration.options.env]).toEqual([
				entry.executable,
				entry.args,
				{ SERVER_LANES: "all", RUN_MIGRATION_ONLY: "true", SERVER_RUNNER_SOCKET_DIR: undefined },
			]);
			expect([interactive.command, interactive.args, interactive.options.env]).toEqual([
				entry.executable,
				entry.args,
				{ SERVER_LANES: "interactive", SANDBOX_MEMORY_BUDGET_MIB: "952" },
			]);
			expect([background.command, background.args, background.options.env]).toEqual([
				"nice",
				["-n", "19", entry.executable, ...entry.args],
				{ SERVER_LANES: "background", SANDBOX_MEMORY_BUDGET_MIB: "952" },
			]);
			expect([migration, interactive, background].map((spec) => spec.options.extendEnv)).toEqual([
				true,
				true,
				true,
			]);
		}),
	);

	test.effect("starts no role when the migration process fails", () =>
		Effect.gen(function* () {
			const { spawner, started } = makeSpawner({ migration: 3 });
			const exit = yield* Effect.exit(supervise(spawner));

			assert(Exit.isFailure(exit));
			const failure = Cause.findErrorOption(exit.cause);
			assert(Option.isSome(failure));
			expect(failure.value).toEqual(
				new SplitSupervisorError({ exitCode: 3, message: "Migration process exited with code 3" }),
			);
			expect(started.map(({ role }) => role)).toEqual(["migration"]);
		}),
	);

	test.effect("exits with the code of the first role that exits and terminates the other", () =>
		Effect.gen(function* () {
			const { killed, spawner, started } = makeSpawner({ background: 7 });
			const exit = yield* Effect.exit(supervise(spawner));

			assert(Exit.isFailure(exit));
			expect(started.map(({ role }) => role)).toEqual(["migration", "interactive", "background"]);
			expect(sortBy(killed)).toEqual(["background", "interactive"]);
			const failure = Cause.findErrorOption(exit.cause);
			assert(Option.isSome(failure));
			expect(failure.value).toEqual(
				new SplitSupervisorError({
					exitCode: 7,
					message: "The background role exited with code 7",
				}),
			);
		}),
	);

	test.effect("terminates both roles when interrupted", () =>
		Effect.gen(function* () {
			const { killed, spawner, started } = makeSpawner();
			const fiber = yield* Effect.forkChild(supervise(spawner));
			while (started.length < 3) {
				yield* Effect.yieldNow;
			}
			yield* Fiber.interrupt(fiber);

			expect(sortBy(killed)).toEqual(["background", "interactive"]);
		}),
	);

	it("reports the supervisor failure as the process exit code", () => {
		expect(
			new SplitSupervisorError({ exitCode: 7, message: "x" })["~effect/Runtime/errorExitCode"],
		).toBe(7);
	});
});

layer(configured(1000))("split supervisor with an undividable budget", (test) => {
	test.effect("refuses to start anything", () =>
		Effect.gen(function* () {
			const { spawner, started } = makeSpawner();
			const exit = yield* Effect.exit(supervise(spawner));

			assert(Exit.isFailure(exit));
			expect(started).toEqual([]);
		}),
	);
});

const mebibytes = (value: number) => value * MiB;

describe("splitMemoryBudget", () => {
	it("defaults the total to half the effective memory and halves it per role", () => {
		expect(splitMemoryBudget(Option.none(), mebibytes(3809))).toEqual(
			Result.succeed({ roleMiB: 952, totalMiB: 1904 }),
		);
	});

	it("divides an explicit total", () => {
		expect(splitMemoryBudget(Option.some(2000), mebibytes(8192))).toEqual(
			Result.succeed({ roleMiB: 1000, totalMiB: 2000 }),
		);
	});

	it("accepts exactly the shared-mode minimum per role and rejects less", () => {
		expect(Result.isSuccess(splitMemoryBudget(Option.some(1708), mebibytes(8192)))).toBe(true);
		const failure = splitMemoryBudget(Option.some(1707), mebibytes(8192));
		assert(Result.isFailure(failure));
		expect(String(failure.failure)).toContain("at least 1708 MiB");
		expect(String(failure.failure)).toContain("3416 MiB of effective memory");
	});

	it("fails the default below the minimum effective memory", () => {
		expect(Result.isSuccess(splitMemoryBudget(Option.none(), mebibytes(3416)))).toBe(true);
		expect(Result.isFailure(splitMemoryBudget(Option.none(), mebibytes(3414)))).toBe(true);
	});

	it("keeps the half-memory check on the total", () => {
		const failure = splitMemoryBudget(Option.some(2049), mebibytes(4096));
		assert(Result.isFailure(failure));
		expect(String(failure.failure)).toContain("exceeds half the effective host memory");
	});
});
