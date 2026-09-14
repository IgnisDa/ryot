#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Path, Schema } from "effect";

const ShippedPlugins = Schema.fromJsonString(Schema.Array(Schema.String));

const serverRoot = Bun.fileURLToPath(new URL("..", import.meta.url));

const packageRoot = (slug: string) =>
	Bun.fileURLToPath(new URL(`../../../plugins/${slug}`, import.meta.url));

export const readShippedSlugs = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	return yield* Schema.decodeEffect(ShippedPlugins)(
		yield* fs.readFileString(path.join(serverRoot, "shipped-plugins.json")),
	);
});

const prepareLayout = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	for (const directory of ["plugins", "storage", "work", "tmp"]) {
		yield* fs.makeDirectory(directory, { recursive: true });
	}
	yield* fs.remove("src/drizzle", { force: true, recursive: true });
	yield* fs.symlink("../../../kernel/backend/src/drizzle", "src/drizzle");
});

export const assemble = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const slugs = yield* readShippedSlugs;
	yield* prepareLayout;
	for (const slug of slugs) {
		const destination = path.join("plugins", `${slug}.zip`);
		yield* fs.remove(path.join("plugins", slug), { force: true, recursive: true });
		yield* fs.copyFile(path.join(packageRoot(slug), `dist/${slug}.zip`), destination);
	}
});

if (import.meta.main) {
	BunRuntime.runMain(assemble.pipe(Effect.provide(BunServices.layer)));
}
