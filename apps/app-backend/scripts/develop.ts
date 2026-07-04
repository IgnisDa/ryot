#!/usr/bin/env bun

import { Command } from "@effect/platform";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";

type ProcessCommand = readonly [string, ...string[]];

const compileCommand: ProcessCommand = [
	process.execPath,
	"run",
	"scripts/compile-sandbox-builtins.ts",
];
export const developmentCommands: readonly [ProcessCommand, ProcessCommand] = [
	[...compileCommand, "--watch", "--skip-initial"],
	[process.execPath, "run", "--watch", "src/main.ts"],
];

const runCommand = ([executable, ...args]: ProcessCommand) =>
	Command.make(executable, ...args).pipe(
		Command.stdin("inherit"),
		Command.stdout("inherit"),
		Command.stderr("inherit"),
		Command.exitCode,
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

BunRuntime.runMain(program.pipe(Effect.provide(BunContext.layer)));
