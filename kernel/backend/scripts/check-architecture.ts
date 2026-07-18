#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Data, Effect, Path } from "effect";

import { findDuplicateServiceLayers, type LayerWiringSource } from "./layer-wiring";
import { analyzeRuntimeModules, formatRuntimeCycleDiagnostics } from "./runtime-module-analysis";
import { walkSourceFiles } from "./walk-source-tree";

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

const walkSources = (directory: string, workspaceRoot: string) =>
	walkSourceFiles(directory, workspaceRoot, isProductionSourcePath).pipe(
		Effect.map((files) =>
			Object.entries(files).map(([path, source]) => ({ path, source }) satisfies LayerWiringSource),
		),
	);

const backupOnlyRestoreCalls = [
	".restoreEntity(",
	".restoreEvents(",
	".restoreRelationship(",
	".restorePortableProfile(",
	".restoreRenderer(",
	".restoreForUser(",
	".restoreTranslation(",
	".restoreCustomView(",
	".restoreBuiltinViews(",
	".restoreBuiltinStateBySlug(",
	".restoreNotificationSubscription(",
	".activateRestored(",
	"installations.restore(",
];

const findBackupRestoreBoundaryViolations = (sources: ReadonlyArray<LayerWiringSource>) =>
	sources.flatMap(({ path, source }) => {
		if (path.startsWith("kernel/backend/src/modules/backups/restore/")) {
			return [];
		}
		return backupOnlyRestoreCalls.flatMap((call) =>
			source.includes(call)
				? [
						`${path}: ${call.slice(0, -1)} is a historical write reserved for the backup restore module`,
					]
				: [],
		);
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
	const backupRestoreBoundaryViolations = findBackupRestoreBoundaryViolations(sources);
	if (cycles.length || duplicateLayers.length || backupRestoreBoundaryViolations.length) {
		return yield* new ArchitectureCheckError({
			message: [
				...duplicateLayers,
				...backupRestoreBoundaryViolations,
				...(cycles.length ? [formatRuntimeCycleDiagnostics(cycles)] : []),
			].join("\n"),
		});
	}
	return yield* Effect.logInfo(`Kernel architecture checks passed (${sources.length} files)`);
}).pipe(Effect.tapError((error) => Effect.logError(String(error))));

BunRuntime.runMain(program.pipe(Effect.provide(BunServices.layer)));
