#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { sandboxRuntimeInputs } from "@ryot-app/sandbox-compiler/runtime-build/inputs";
import { buildSandboxRuntimePayload } from "@ryot-app/sandbox-compiler/runtime-build/payload";
import { walkSourceFiles } from "@ryot-app/sandbox-compiler/runtime-build/source-tree";
import { SANDBOX_RUNTIME_REGISTRY } from "@ryot-app/sandbox-sdk/runtime-registry";
import { canonicalFileSetHash } from "@ryot-app/ts-utils/crypto";
import { buildSandboxEsm, ViteBuildService } from "@ryot-app/vite-compiler";
import { Data, Effect, FileSystem, Layer, Path, Ref } from "effect";

class RunnerGenerationError extends Data.TaggedError("RunnerGenerationError")<{
	message: string;
}> {}

// The trusted guest runner: everything the isolate evaluates before the script module.
const GUEST_SOURCE_FILES = [
	"guest/invocation.ts",
	"guest/bootstrap.ts",
	"guest/primordials.ts",
	"guest/utilities.ts",
	"protocol/limits.ts",
	"protocol/messages.ts",
];

const compileTrustedRunner = (sandboxDirectory: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const sourceDirectory = path.join(sandboxDirectory, "src");
		const sources = yield* walkSourceFiles(sourceDirectory, sourceDirectory, (file) =>
			GUEST_SOURCE_FILES.some((name) => file.endsWith(`/src/${name}`)),
		);
		const externalSpecifiers = new Set(
			SANDBOX_RUNTIME_REGISTRY.filter(({ runner }) => runner).flatMap(({ aliases, sdkImport }) =>
				Array.of<string>(sdkImport).concat(aliases),
			),
		);
		const { javascript } = yield* buildSandboxEsm({
			outputFile: "runner.mjs",
			entry: "guest/invocation.ts",
			approvedExternalSpecifiers: externalSpecifiers,
			approvedDynamicImportExpressions: new Set(["specifier"]),
			sources: Object.entries(sources).map(([sourcePath, contents]) => ({
				contents,
				path: sourcePath,
			})),
			aliases: [
				{
					find: "@ryot-app/sandbox-sdk/core",
					replacement: Bun.resolveSync("@ryot-app/sandbox-sdk/core", import.meta.dir),
				},
				{
					find: "@ryot-app/sandbox-sdk/workflow",
					replacement: Bun.resolveSync("@ryot-app/sandbox-sdk/workflow", import.meta.dir),
				},
				{
					find: "@ryot-app/sandbox-compiler/limits",
					replacement: Bun.resolveSync("@ryot-app/sandbox-compiler/limits", import.meta.dir),
				},
				{
					find: /^@ryot-app\/contract\/(.+)$/,
					replacement: `${path.resolve(sandboxDirectory, "../..", "packages/contract/src")}/$1`,
				},
			],
		}).pipe(
			Effect.mapError(
				(error) =>
					new RunnerGenerationError({
						message: `Trusted sandbox runner build failed: ${error.message}`,
					}),
			),
		);
		yield* fs.writeFileString(path.join(sandboxDirectory, "native/payload/runner.mjs"), javascript);
		yield* Effect.logInfo("Compiled trusted native sandbox runner");
	});

const compileRuntimePayload = (sandboxDirectory: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const payload = yield* buildSandboxRuntimePayload(sandboxDirectory).pipe(
			Effect.mapError(
				(error) =>
					new RunnerGenerationError({
						message: `Trusted sandbox runtime build failed: ${error.message}`,
					}),
			),
		);
		const payloadDirectory = path.join(sandboxDirectory, "native/payload");
		yield* fs.remove(payloadDirectory, { force: true, recursive: true });
		yield* fs.makeDirectory(payloadDirectory, { recursive: true });
		yield* Effect.forEach(
			payload.files,
			(file) => fs.writeFileString(path.join(payloadDirectory, file.path), file.contents),
			{ discard: true },
		);
		yield* Effect.logInfo("Compiled trusted sandbox runtime payload");
	});

const generateRuntime = (sandboxDirectory: string) =>
	compileRuntimePayload(sandboxDirectory).pipe(
		Effect.andThen(compileTrustedRunner(sandboxDirectory)),
	);

const fingerprintOf = (files: Readonly<Record<string, string>>) =>
	canonicalFileSetHash(Object.entries(files).map(([path, contents]) => ({ path, contents })));

const program = Effect.gen(function* () {
	const path = yield* Path.Path;
	const scriptPath = yield* path.fromFileUrl(new URL(import.meta.url));
	const sandboxDirectory = path.resolve(path.dirname(scriptPath), "..");
	if (!process.argv.includes("--skip-initial")) {
		yield* generateRuntime(sandboxDirectory);
	}
	if (!process.argv.includes("--watch")) {
		return yield* Effect.void;
	}

	const sources = yield* sandboxRuntimeInputs(sandboxDirectory, GUEST_SOURCE_FILES);
	const currentFingerprint = yield* Ref.make(fingerprintOf(sources));
	return yield* Effect.gen(function* () {
		yield* Effect.sleep("250 millis");
		const nextSources = yield* sandboxRuntimeInputs(sandboxDirectory, GUEST_SOURCE_FILES);
		const nextFingerprint = fingerprintOf(nextSources);
		if (nextFingerprint !== (yield* Ref.get(currentFingerprint))) {
			const compiled = yield* Effect.result(generateRuntime(sandboxDirectory));
			if (compiled._tag === "Success") {
				yield* Ref.set(currentFingerprint, nextFingerprint);
			} else {
				yield* Effect.sleep("2 seconds");
			}
		}
	}).pipe(Effect.forever);
}).pipe(Effect.tapError((error) => Effect.logError(JSON.stringify(error, null, 2))));

BunRuntime.runMain(
	// oxlint-disable-next-line effecttsgo/strict-effect-provide -- The sandbox runtime generator is a command-line entrypoint
	program.pipe(Effect.provide(Layer.mergeAll(BunServices.layer, ViteBuildService.layer))),
);
