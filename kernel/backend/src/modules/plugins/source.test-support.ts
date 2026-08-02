import { Data, Effect, FileSystem, Stream } from "effect";

import type { PluginSource } from "./types";

export class PluginSourceError extends Data.TaggedError("PluginSourceError")<{
	readonly message: string;
}> {}

const pluginSourcePaths = (packageRoot: string) =>
	Stream.fromAsyncIterable(
		new Bun.Glob("**/*.ts").scan({ onlyFiles: true, cwd: packageRoot, followSymlinks: false }),
		(error) => new PluginSourceError({ message: String(error) }),
	).pipe(
		Stream.filter((path) => !path.endsWith(".test.ts")),
		Stream.runCollect,
	);

export const loadPluginSource = (packageRoot: string, manifest: unknown) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const paths = yield* pluginSourcePaths(packageRoot);
		const entries = yield* Effect.forEach(paths, (path) =>
			fs.readFileString(`${packageRoot}/${path}`).pipe(
				Effect.mapError((error) => new PluginSourceError({ message: String(error) })),
				Effect.map((contents) => [path, contents] as const),
			),
		);
		return { manifest, files: Object.fromEntries(entries) } satisfies PluginSource;
	});
