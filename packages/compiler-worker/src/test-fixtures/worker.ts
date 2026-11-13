import { BunFileSystem } from "@effect/platform-bun";
import { Effect, FileSystem, Layer } from "effect";

import { runCompilerWorker } from "../host";

const commands: Record<
	string,
	(argument: string) => Effect.Effect<string, unknown, FileSystem.FileSystem>
> = {
	pid: () => Effect.succeed(String(process.pid)),
	exit: () => Effect.sync(() => process.exit(3)),
	env: (name) => Effect.succeed(process.env[name] ?? ""),
	large: (bytes) => Effect.succeed("x".repeat(Number(bytes))),
	sleep: (milliseconds) => Effect.sleep(Number(milliseconds)).pipe(Effect.as("slept")),
	workspace: (directory) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			yield* fs.makeDirectory(directory);
			yield* fs.writeFileString(`${directory}/file`, "staged");
			return "staged";
		}),
};

runCompilerWorker({
	warmUp: Effect.void,
	layer: ({ verifyEnvironment }) =>
		Layer.merge(
			BunFileSystem.layer,
			verifyEnvironment ? Layer.effectDiscard(Effect.die("environment is broken")) : Layer.empty,
		),
	handle: (request) => {
		const separator = request.indexOf(":");
		const name = separator === -1 ? request : request.slice(0, separator);
		const argument = separator === -1 ? "" : request.slice(separator + 1);
		return (commands[name]?.(argument) ?? Effect.succeed(`unknown:${request}`)).pipe(Effect.orDie);
	},
});
