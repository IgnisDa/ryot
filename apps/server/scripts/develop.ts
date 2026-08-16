#!/usr/bin/env bun

import { BunServices, BunRuntime } from "@effect/platform-bun";
import dotenv from "dotenv";
import { Effect } from "effect";
import { ChildProcess } from "effect/unstable/process";

dotenv.config();

type ProcessCommand = readonly [string, ...string[]];

const compileSandboxRunnerScript = Bun.fileURLToPath(
	new URL("../../../kernel/backend/scripts/compile-sandbox-runner.ts", import.meta.url),
);

const compileCommand: ProcessCommand = [process.execPath, "run", compileSandboxRunnerScript];
export const developmentCommands: readonly [ProcessCommand, ProcessCommand] = [
	[...compileCommand, "--watch", "--skip-initial"],
	[process.execPath, "run", "--watch", "src/main.ts"],
];

const runCommand = ([executable, ...args]: ProcessCommand) =>
	ChildProcess.make(executable, args, {
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	}).pipe(
		Effect.flatMap((process) => process.exitCode),
		Effect.scoped,
	);

const program = Effect.gen(function* () {
	const compilationExitCode = yield* runCommand(compileCommand);
	if (compilationExitCode !== 0) {
		yield* Effect.sync(() => {
			process.exitCode = compilationExitCode;
		});
		return;
	}

	const exitCode = yield* Effect.raceFirst(
		runCommand(developmentCommands[0]),
		runCommand(developmentCommands[1]),
	);
	yield* Effect.sync(() => {
		process.exitCode = exitCode;
	});
});

BunRuntime.runMain(program.pipe(Effect.provide(BunServices.layer)));
