#!/usr/bin/env bun

import { BunServices, BunRuntime } from "@effect/platform-bun";
import { CompilerWorkerResponse } from "@ryot/sandbox-compiler/protocol";
import { Data, Effect, Schema, Stream } from "effect";
import { ChildProcess } from "effect/unstable/process";

class CompilerWorkerSmokeError extends Data.TaggedError("CompilerWorkerSmokeError")<{
	message: string;
}> {}

const decodeWorkerResponse = Schema.decodeUnknownEffect(
	Schema.fromJsonString(CompilerWorkerResponse),
);

const program = Effect.gen(function* () {
	const workerPath = process.argv[2];
	if (!workerPath) {
		return yield* new CompilerWorkerSmokeError({ message: "Compiler worker path is required" });
	}

	const command = ChildProcess.make(
		process.execPath,
		["--smol", "--no-orphans", "--no-install", "--no-env-file", workerPath],
		{ stdin: Stream.empty, stdout: "pipe", stderr: "pipe" },
	);
	const worker = yield* command;
	yield* Effect.addFinalizer(() => worker.kill({ killSignal: "SIGKILL" }).pipe(Effect.ignore));
	const { exitCode, stderr, stdout } = yield* Effect.all(
		{
			stdout: worker.stdout.pipe(
				Stream.decodeText({ encoding: "utf-8" }),
				Stream.runFold(
					() => "",
					(output, chunk) => output + chunk,
				),
			),
			stderr: worker.stderr.pipe(
				Stream.decodeText({ encoding: "utf-8" }),
				Stream.runFold(
					() => "",
					(output, chunk) => output + chunk,
				),
			),
			exitCode: worker.exitCode,
		},
		{ concurrency: "unbounded" },
	);
	if (exitCode !== 0) {
		return yield* new CompilerWorkerSmokeError({
			message: `Compiler worker exited with code ${exitCode}: ${stderr.length > 0 ? stderr : stdout}`,
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

BunRuntime.runMain(Effect.scoped(program).pipe(Effect.provide(BunServices.layer)));
