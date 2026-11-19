import { BunRuntime } from "@effect/platform-bun";
import { Effect, Layer, Logger, Schema, Stream } from "effect";

import { COMPILER_WORKER_READY, VERIFY_ENVIRONMENT_ARGUMENT } from "./protocol";

export type CompilerWorkerEnvironment = { readonly verifyEnvironment: boolean };

class CompilerWorkerInputFailed extends Schema.TaggedError<
	CompilerWorkerInputFailed,
	{ readonly brand: unique symbol }
>()("CompilerWorkerInputFailed", { message: Schema.String }) {}

const writeLine = (line: string) => Effect.promise(() => Bun.write(Bun.stdout, `${line}\n`));

export const runCompilerWorker = <R, E>(options: {
	readonly warmUp: Effect.Effect<unknown, unknown, R>;
	readonly handle: (request: string) => Effect.Effect<string, never, R>;
	readonly layer: (environment: CompilerWorkerEnvironment) => Layer.Layer<R, E>;
}) => {
	const environment = { verifyEnvironment: process.argv.includes(VERIFY_ENVIRONMENT_ARGUMENT) };
	const program = Effect.gen(function* () {
		yield* options.warmUp;
		yield* writeLine(COMPILER_WORKER_READY);
		yield* Stream.fromReadableStream({
			evaluate: () => Bun.stdin.stream(),
			onError: (error) => new CompilerWorkerInputFailed({ message: String(error) }),
		}).pipe(
			Stream.decodeText(),
			Stream.splitLines,
			Stream.runForEach((request) =>
				request === "" ? Effect.void : options.handle(request).pipe(Effect.flatMap(writeLine)),
			),
		);
	});
	// Stdout carries only protocol lines, so diagnostics and startup failures go to stderr.
	const logToStderr = Layer.succeed(Logger.LogToStderr, true);
	BunRuntime.runMain(
		program.pipe(
			Effect.tapCause(Effect.logError),
			Effect.provide(
				Layer.merge(
					logToStderr,
					options
						.layer(environment)
						.pipe(Layer.tapCause(Effect.logError), Layer.provide(logToStderr)),
				),
			),
		),
		{ disableErrorReporting: true },
	);
};
