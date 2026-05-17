#!/usr/bin/env bun

import { BunServices, BunRuntime } from "@effect/platform-bun";
import dotenv from "dotenv";
import { Effect, FileSystem, Stream } from "effect";
import { ChildProcess } from "effect/unstable/process";

dotenv.config();

type ProcessCommand = readonly [string, ...string[]];

const compileSandboxRunnerScript = Bun.fileURLToPath(
	new URL("../../../kernel/backend/scripts/compile-sandbox-runner.ts", import.meta.url),
);

const compileCommand: ProcessCommand = [process.execPath, "run", compileSandboxRunnerScript];
const pluginBuildCommand: ProcessCommand = [
	process.execPath,
	"turbo",
	"--filter=@ryot/media-plugin",
	"--filter=@ryot/fitness-plugin",
	"build",
];
const assembleCommand: ProcessCommand = [process.execPath, "run", "assemble"];
export const developmentCommands: readonly [ProcessCommand, ProcessCommand] = [
	[...compileCommand, "--watch", "--skip-initial"],
	[process.execPath, "run", "assemble", "--watch"],
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
	for (const command of [compileCommand, pluginBuildCommand, assembleCommand]) {
		const exitCode = yield* runCommand(command);
		if (exitCode === 0) {
			continue;
		}
		yield* Effect.sync(() => {
			process.exitCode = exitCode;
		});
		return;
	}

	const runServer = Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		while (true) {
			const result = yield* Effect.raceFirst(
				runCommand([process.execPath, "run", "--watch", "src/main.ts"]).pipe(
					Effect.map((exitCode) => ({ exitCode, restart: false as const })),
				),
				fs
					.watch("plugins")
					.pipe(
						Stream.debounce("500 millis"),
						Stream.runHead,
						Effect.as({ restart: true as const }),
					),
			);
			if (!result.restart) {
				return result.exitCode;
			}
		}
	});

	const exitCode = yield* Effect.raceFirst(
		runCommand(developmentCommands[0]),
		Effect.raceFirst(runCommand(developmentCommands[1]), runServer),
	);
	yield* Effect.sync(() => {
		process.exitCode = exitCode;
	});
});

BunRuntime.runMain(program.pipe(Effect.provide(BunServices.layer)));
