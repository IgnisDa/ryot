#!/usr/bin/env bun

import { BunFileSystem, BunPath, BunRuntime } from "@effect/platform-bun";
import { Data, Effect, Layer, FileSystem, Path } from "effect";

import {
	deriveDomainVocabulary,
	formatPurityFinding,
	isProductionSourcePath,
	scanPuritySources,
	type PuritySource,
} from "./kernel-purity";
import { findDuplicateServiceLayers } from "./layer-wiring";
import { analyzeRuntimeModules, formatRuntimeCycleDiagnostics } from "./runtime-module-analysis";

class KernelPurityError extends Data.TaggedError("KernelPurityError")<{ message: string }> {}

const walkSources = (
	directory: string,
	workspaceRoot: string,
): Effect.Effect<ReadonlyArray<PuritySource>, unknown, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const sources: PuritySource[] = [];
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
	const manifests = yield* Effect.forEach(["media", "fitness"], (plugin) =>
		Effect.tryPromise(() => import(path.join(workspaceRoot, `plugins/${plugin}/manifest.ts`))).pipe(
			Effect.map((module) => module.default),
		),
	);
	const roots = ["kernel/backend/src", "packages/contract/src", "packages/ryotql/src"].map((root) =>
		path.join(workspaceRoot, root),
	);
	const cycles = yield* analyzeRuntimeModules(modulesDir);
	const sources = (yield* Effect.forEach(roots, (root) => walkSources(root, workspaceRoot))).flat();
	const terms = deriveDomainVocabulary(manifests);
	const findings = scanPuritySources(sources, terms);
	const duplicateLayers = findDuplicateServiceLayers(sources);
	if (cycles.length || findings.length || duplicateLayers.length) {
		return yield* new KernelPurityError({
			message: [
				...duplicateLayers,
				...findings.map(formatPurityFinding),
				...(cycles.length ? [formatRuntimeCycleDiagnostics(cycles)] : []),
			].join("\n"),
		});
	}
	return yield* Effect.logInfo(
		`Kernel purity passed (${sources.length} files, ${terms.length} terms)`,
	);
}).pipe(Effect.tapError((error) => Effect.logError(String(error))));

BunRuntime.runMain(
	program.pipe(Effect.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))),
);
