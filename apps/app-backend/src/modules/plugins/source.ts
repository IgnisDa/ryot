import { Data, Effect, FileSystem } from "effect";

import type { PluginSource } from "./types";

export class PluginSourceError extends Data.TaggedError("PluginSourceError")<{
	readonly message: string;
}> {}

export const loadPluginSource = (packageRoot: string, manifest: unknown) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const paths = yield* fs
			.glob("**/*.ts", { root: packageRoot, exclude: ["node_modules/**"] })
			.pipe(
				Effect.mapError((error) => new PluginSourceError({ message: String(error) })),
				Effect.map((matchedPaths) => matchedPaths.filter((path) => !path.endsWith(".test.ts"))),
			);
		const entries = yield* Effect.forEach(paths, (path) =>
			fs.readFileString(`${packageRoot}/${path}`).pipe(
				Effect.mapError((error) => new PluginSourceError({ message: String(error) })),
				Effect.map((contents) => [path, contents] as const),
			),
		);
		return { manifest, files: Object.fromEntries(entries) } satisfies PluginSource;
	});
