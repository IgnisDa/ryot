import { Data, Effect } from "effect";

import type { PluginSource } from "./types";

export class PluginSourceError extends Data.TaggedError("PluginSourceError")<{
	readonly message: string;
}> {}

export const loadPluginSource = (packageRoot: string, manifest: unknown) =>
	Effect.gen(function* () {
		const paths = yield* Effect.try({
			try: () =>
				Array.from(new Bun.Glob("**/*.ts").scanSync({ cwd: packageRoot, onlyFiles: true })).filter(
					(path) => !path.endsWith(".test.ts"),
				),
			catch: (error) => new PluginSourceError({ message: String(error) }),
		});
		const entries = yield* Effect.forEach(paths, (path) =>
			Effect.tryPromise({
				try: () => Bun.file(`${packageRoot}/${path}`).text(),
				catch: (error) => new PluginSourceError({ message: String(error) }),
			}).pipe(Effect.map((contents) => [path, contents] as const)),
		);
		return { manifest, files: Object.fromEntries(entries) } satisfies PluginSource;
	});
