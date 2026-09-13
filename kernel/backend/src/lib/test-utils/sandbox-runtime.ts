import { Effect, Path } from "effect";

export const sandboxRuntimeDirectory = Effect.gen(function* () {
	const path = yield* Path.Path;
	const source = yield* path.fromFileUrl(new URL(import.meta.url));
	return path.resolve(path.dirname(source), "../../../../sandboxd/dist");
});
