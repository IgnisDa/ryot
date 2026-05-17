#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Path, Schema } from "effect";
import { ChildProcess } from "effect/unstable/process";

const ShippedPlugins = Schema.fromJsonString(Schema.Array(Schema.String));

const readSlugs = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	return yield* Schema.decodeUnknownEffect(ShippedPlugins)(
		yield* fs.readFileString("shipped-plugins.json"),
	);
});

const packageRoot = (slug: string) => `../../plugins/${slug}`;

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
	const slugs = yield* readSlugs;
	yield* prepareLayout;
	for (const slug of slugs) {
		const destination = path.join("plugins", slug);
		yield* fs.remove(destination, { force: true, recursive: true });
		yield* fs.copy(path.join(packageRoot(slug), "dist/bundle"), destination);
	}
});

const watch = Effect.gen(function* () {
	const slugs = yield* readSlugs;
	yield* prepareLayout;
	yield* Effect.all(
		slugs.map((slug) =>
			ChildProcess.make(
				"ryot",
				["plugin", "build", "--watch", "--output", `../../apps/server/plugins/${slug}`],
				{ cwd: packageRoot(slug), stderr: "inherit", stdin: "inherit", stdout: "inherit" },
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
