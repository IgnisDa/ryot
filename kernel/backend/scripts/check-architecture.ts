#!/usr/bin/env bun

import { BunFileSystem, BunPath, BunRuntime } from "@effect/platform-bun";
import { Data, Effect, Layer, FileSystem, Path } from "effect";

import { findDuplicateServiceLayers, type LayerWiringSource } from "./layer-wiring";
import { analyzeRuntimeModules, formatRuntimeCycleDiagnostics } from "./runtime-module-analysis";

class ArchitectureCheckError extends Data.TaggedError("ArchitectureCheckError")<{
	message: string;
}> {}

const isProductionSourcePath = (file: string) =>
	file.endsWith(".ts") &&
	!file.endsWith(".test.ts") &&
	!file.endsWith(".spec.ts") &&
	!file.endsWith(".test-support.ts") &&
	!file.endsWith(".test-fixture.ts") &&
	!file.endsWith(".typecheck.ts") &&
	!file.endsWith(".generated.ts") &&
	!file.replaceAll("\\", "/").includes("/test-fixtures/");

const walkSources = (
	directory: string,
	workspaceRoot: string,
): Effect.Effect<ReadonlyArray<LayerWiringSource>, unknown, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const sources: LayerWiringSource[] = [];
		for (const entry of (yield* fs.readDirectory(directory)).sort()) {
			const absolutePath = path.join(directory, entry);
			const info = yield* fs.stat(absolutePath);
			if (info.type === "Directory") {
				sources.push(...(yield* walkSources(absolutePath, workspaceRoot)));
				continue;
			}
			const relativePath = path.relative(workspaceRoot, absolutePath).split(path.sep).join("/");
			if (isProductionSourcePath(relativePath)) {
				sources.push({ path: relativePath, source: yield* fs.readFileString(absolutePath) });
			}
		}
		return sources;
	});

const program = Effect.gen(function* () {
	const path = yield* Path.Path;
	const scriptPath = yield* path.fromFileUrl(new URL(import.meta.url));
	const workspaceRoot = path.resolve(path.dirname(scriptPath), "..", "..", "..");
	const modulesDir = path.join(workspaceRoot, "kernel/backend/src/modules");
	const roots = ["kernel/backend/src", "packages/contract/src", "packages/ryotql/src"].map((root) =>
		path.join(workspaceRoot, root),
	);
	const cycles = yield* analyzeRuntimeModules(modulesDir);
	const sources = (yield* Effect.forEach(roots, (root) => walkSources(root, workspaceRoot))).flat();
	const duplicateLayers = findDuplicateServiceLayers(sources);
	if (cycles.length || duplicateLayers.length) {
		return yield* new ArchitectureCheckError({
			message: [
				...duplicateLayers,
				...(cycles.length ? [formatRuntimeCycleDiagnostics(cycles)] : []),
			].join("\n"),
		});
	}
	return yield* Effect.logInfo(`Kernel architecture checks passed (${sources.length} files)`);
}).pipe(Effect.tapError((error) => Effect.logError(String(error))));

BunRuntime.runMain(
	program.pipe(Effect.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))),
);
