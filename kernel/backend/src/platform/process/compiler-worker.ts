import { Effect, Path } from "effect";

export const compilerWorkerPath = (specifier: string, packagedFile: string) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const current = new URL(import.meta.url);
		const currentPath = yield* path.fromFileUrl(current).pipe(Effect.orDie);
		return currentPath.endsWith(".ts")
			? Bun.resolveSync(specifier, currentPath)
			: yield* path.fromFileUrl(new URL(`./${packagedFile}`, current)).pipe(Effect.orDie);
	});
