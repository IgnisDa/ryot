#!/usr/bin/env bun

import { Command, CommandExecutor } from "@effect/platform";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { CompilerWorkerResponse } from "@ryot/sandbox-compiler/protocol";
import { Data, Effect, Schema, Stream } from "effect";

class CompilerWorkerSmokeError extends Data.TaggedError("CompilerWorkerSmokeError")<{
	message: string;
}> {}

const decodeWorkerResponse = Schema.decode(Schema.parseJson(CompilerWorkerResponse));

const program = Effect.gen(function* () {
	const workerPath = process.argv[2];
	if (!workerPath) {
		return yield* new CompilerWorkerSmokeError({ message: "Compiler worker path is required" });
	}

	const executor = yield* CommandExecutor.CommandExecutor;
	const command = Command.make(
		process.execPath,
		"--smol",
		"--no-orphans",
		"--no-install",
		"--no-env-file",
		workerPath,
	).pipe(Command.feed(""), Command.stdout("pipe"), Command.stderr("pipe"));
	const worker = yield* executor.start(command);
	yield* Effect.addFinalizer(() => worker.kill("SIGKILL").pipe(Effect.ignore));
	const [stdout, stderr, exitCode] = yield* Effect.all(
		[
			worker.stdout.pipe(
				Stream.decodeText("utf-8"),
				Stream.runFold("", (output, chunk) => output + chunk),
			),
			worker.stderr.pipe(
				Stream.decodeText("utf-8"),
				Stream.runFold("", (output, chunk) => output + chunk),
			),
			worker.exitCode,
		],
		{ concurrency: "unbounded" },
	);
	if (exitCode !== 0) {
		return yield* new CompilerWorkerSmokeError({
			message: `Compiler worker exited with code ${exitCode}: ${stderr || stdout}`,
		});
	}

	const response = yield* decodeWorkerResponse(stdout).pipe(
		Effect.mapError(
			(error) =>
				new CompilerWorkerSmokeError({
					message: `Compiler worker returned an invalid response: ${String(error)}`,
				}),
		),
	);
	if (
		response.success ||
		response.error.diagnostics.some(
			({ code }) => code === "RYOT_COMPILER" || code === "RYOT_COMPILER_PROCESS",
		)
	) {
		return yield* new CompilerWorkerSmokeError({
			message: `Compiler worker smoke returned an unexpected response: ${stdout}`,
		});
	}
	return yield* Effect.void;
});

BunRuntime.runMain(Effect.scoped(program).pipe(Effect.provide(BunContext.layer)));
