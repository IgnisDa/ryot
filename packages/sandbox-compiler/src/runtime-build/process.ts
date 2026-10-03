import { Effect, Stream } from "effect";
import { ChildProcess } from "effect/unstable/process";

const collectText = <E, R>(stream: Stream.Stream<Uint8Array, E, R>) =>
	stream.pipe(
		Stream.decodeText({ encoding: "utf-8" }),
		Stream.runFold(
			(): string => "",
			(output, chunk) => output + chunk,
		),
	);

export interface RunProcessOptions {
	readonly input?: string | undefined;
	readonly env?: Record<string, string | undefined> | undefined;
}

export const runProcessCapturing = (
	executable: string,
	args: ReadonlyArray<string>,
	options: RunProcessOptions = {},
) =>
	Effect.gen(function* () {
		const child = yield* ChildProcess.make(executable, args, {
			stdout: "pipe",
			stderr: "pipe",
			...(options.env === undefined ? {} : { env: options.env }),
			...(options.input === undefined
				? {}
				: { stdin: Stream.succeed(new TextEncoder().encode(options.input)) }),
		});
		yield* Effect.addFinalizer(() => child.kill({ killSignal: "SIGKILL" }).pipe(Effect.ignore));
		return yield* Effect.all(
			{
				exitCode: child.exitCode,
				stdout: collectText(child.stdout),
				stderr: collectText(child.stderr),
			},
			{ concurrency: "unbounded" },
		);
	});
