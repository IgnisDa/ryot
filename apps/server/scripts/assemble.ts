#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Path } from "effect";
import { ChildProcess } from "effect/unstable/process";

const plugins = [
	{ root: "../../plugins/media", slug: "media" },
	{ root: "../../plugins/fitness", slug: "fitness" },
] as const;

const prepareLayout = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	for (const directory of ["plugins", "storage", "work", "tmp"]) {
		yield* fs.makeDirectory(directory, { recursive: true });
	}
	yield* fs.remove("src/drizzle", { force: true, recursive: true });
	yield* fs.symlink("../../../kernel/backend/src/drizzle", "src/drizzle");
});

const assemble = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	yield* prepareLayout;
	for (const plugin of plugins) {
		const destination = path.join("plugins", plugin.slug);
		yield* fs.remove(destination, { force: true, recursive: true });
		yield* fs.copy(path.join(plugin.root, "dist/bundle"), destination);
	}
});

const watch = Effect.gen(function* () {
	yield* prepareLayout;
	yield* Effect.all(
		plugins.map((plugin) =>
			ChildProcess.make(
				"ryot",
				["plugin", "build", "--watch", "--output", `../../apps/server/plugins/${plugin.slug}`],
				{ cwd: plugin.root, stderr: "inherit", stdin: "inherit", stdout: "inherit" },
			).pipe(
				Effect.flatMap((process) => process.exitCode),
				Effect.scoped,
			),
		),
		{ concurrency: "unbounded" },
	);
});

BunRuntime.runMain(
	Effect.gen(function* () {
		if (process.argv.includes("--watch")) {
			return yield* watch;
		}
		return yield* assemble;
	}).pipe(Effect.provide(BunServices.layer)),
);
