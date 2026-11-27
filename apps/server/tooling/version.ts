import { Config, Effect, Option } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export const resolveVersion = Effect.gen(function* () {
	const configured = yield* Config.option(Config.String("RYOT_VERSION"));
	if (Option.isSome(configured) && configured.value.length > 0) {
		return configured.value;
	}
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
	const described = yield* spawner.string(
		ChildProcess.make("git", ["describe", "--tags", "--always", "--dirty"]),
	);
	return described.trim();
});
