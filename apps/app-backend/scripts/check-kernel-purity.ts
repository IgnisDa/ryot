#!/usr/bin/env bun

import { FileSystem, Path } from "@effect/platform";
import { BunFileSystem, BunPath, BunRuntime } from "@effect/platform-bun";
import fitnessPlugin from "@ryot/plugin-fitness";
import mediaPlugin from "@ryot/plugin-media";
import { Data, Effect, Layer } from "effect";

import {
	applyPurityAllowlist,
	deriveDomainVocabulary,
	formatPurityFinding,
	isProductionSourcePath,
	scanPuritySources,
	type PuritySource,
} from "./kernel-purity";
import { kernelPurityAllowlist } from "./kernel-purity-allowlist";

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
	const roots = ["apps/app-backend/src", "libs/contract/src", "libs/query-engine/src"].map((root) =>
		path.join(workspaceRoot, root),
	);
	const sources = (yield* Effect.forEach(roots, (root) => walkSources(root, workspaceRoot))).flat();
	const terms = deriveDomainVocabulary([mediaPlugin, fitnessPlugin]);
	const findings = scanPuritySources(sources, terms);
	const { errors, violations } = applyPurityAllowlist(findings, kernelPurityAllowlist);
	if (errors.length || violations.length) {
		return yield* new KernelPurityError({
			message: [...errors, ...violations.map(formatPurityFinding)].join("\n"),
		});
	}
	return yield* Effect.logInfo(
		`Kernel purity passed (${sources.length} files, ${terms.length} terms, ${findings.length} allowlisted findings)`,
	);
}).pipe(Effect.tapError((error) => Effect.logError(String(error))));

BunRuntime.runMain(
	program.pipe(Effect.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))),
);
