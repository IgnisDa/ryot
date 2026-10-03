#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { compilePluginSandboxSourceEntries } from "@ryot-app/sandbox-compiler/plugins";
import { sandboxRuntimeInputs } from "@ryot-app/sandbox-compiler/runtime-build/inputs";
import { buildSandboxRuntimePayload } from "@ryot-app/sandbox-compiler/runtime-build/payload";
import { walkSourceFiles } from "@ryot-app/sandbox-compiler/runtime-build/source-tree";
import { SANDBOX_RUNTIME_REGISTRY } from "@ryot-app/sandbox-sdk/runtime-registry";
import { canonicalFileSetHash } from "@ryot-app/ts-utils/crypto";
import { encodeJsonString } from "@ryot-app/ts-utils/json";
import { buildSandboxEsm, ViteBuildService } from "@ryot-app/vite-compiler";
import { Data, Effect, FileSystem, Layer, Path, Ref, Schema } from "effect";

import { kernelScripts } from "../src/modules/definition-registry/kernel-source";

class RunnerGenerationError extends Data.TaggedError("RunnerGenerationError")<{
	message: string;
}> {}

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const sandboxSource = (file: string) => file.endsWith(".sandbox.ts");

const embedKernelScripts = (kernelDirectory: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const scripts = yield* walkSourceFiles(
			path.join(kernelDirectory, "src/modules/definition-registry/kernel-scripts"),
			kernelDirectory,
			sandboxSource,
		);
		const entries = Object.entries(scripts)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([entry, source]) => `\t${encodeJsonString(entry)}: ${encodeJsonString(source)},`)
			.join("\n");
		yield* fs.writeFileString(
			path.join(kernelDirectory, "src/modules/definition-registry/kernel-scripts.generated.ts"),
			`export const kernelScriptSources = {\n${entries}\n} as const;\n`,
		);
		const compiled = yield* compilePluginSandboxSourceEntries(scripts, kernelScripts);
		const outputs = kernelScripts.map((script) => {
			const output = compiled.find(({ entry }) => entry === script.entry);
			if (!output) {
				throw new Error(`Kernel script compiler returned no output for ${script.entry}`);
			}
			return {
				entry: script.entry,
				source: output.source,
				format: output.compiled.format,
				manifest: output.compiled.manifest,
				javascript: output.compiled.javascript,
			};
		});
		yield* fs.writeFileString(
			path.join(
				kernelDirectory,
				"src/modules/definition-registry/kernel-scripts.compiled.generated.ts",
			),
			`export const kernelScriptCompiledOutputs = ${encodeJson(outputs)} as const;\n`,
		);
		yield* Effect.logInfo("Embedded kernel sandbox scripts");
	});

const compileTrustedRunner = (kernelDirectory: string, sandboxRuntimeDirectory: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const sourceNames = new Set([
			"isolate-invocation.ts",
			"isolate-bootstrap.ts",
			"isolate-utilities.ts",
			"limits.ts",
			"sidecar-protocol.ts",
		]);
		const sources = yield* walkSourceFiles(
			sandboxRuntimeDirectory,
			sandboxRuntimeDirectory,
			(file) => sourceNames.has(path.basename(file)),
		);
		const externalSpecifiers = new Set<string>();
		for (const dependency of SANDBOX_RUNTIME_REGISTRY) {
			if (
				dependency.name !== "effect" &&
				dependency.name !== "ryotql" &&
				dependency.name !== "dependency-runtime" &&
				dependency.name !== "filesystem"
			) {
				continue;
			}
			externalSpecifiers.add(dependency.sdkImport);
			for (const alias of dependency.aliases) {
				externalSpecifiers.add(alias);
			}
		}
		const { javascript } = yield* buildSandboxEsm({
			outputFile: "runner.mjs",
			entry: "isolate-invocation.ts",
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
					replacement: `${path.resolve(kernelDirectory, "../..", "packages/contract/src")}/$1`,
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
		const sidecarPayloadDirectory = path.resolve(kernelDirectory, "../sandboxd/payload");
		yield* fs.writeFileString(path.join(sidecarPayloadDirectory, "runner.mjs"), javascript);
		yield* Effect.logInfo("Compiled trusted native sandbox runner");
	});

const compileRuntimePayload = (kernelDirectory: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const payload = yield* buildSandboxRuntimePayload(kernelDirectory).pipe(
			Effect.mapError(
				(error) =>
					new RunnerGenerationError({
						message: `Trusted sandbox runtime build failed: ${error.message}`,
					}),
			),
		);
		const sidecarPayloadDirectory = path.resolve(kernelDirectory, "../sandboxd/payload");
		yield* fs.remove(sidecarPayloadDirectory, { force: true, recursive: true });
		yield* fs.makeDirectory(sidecarPayloadDirectory, { recursive: true });
		yield* Effect.forEach(
			payload.files,
			(file) => fs.writeFileString(path.join(sidecarPayloadDirectory, file.path), file.contents),
			{ discard: true },
		);
		yield* Effect.logInfo("Compiled trusted sandbox runtime payload");
	});

const generateRuntime = (kernelDirectory: string, sandboxRuntimeDirectory: string) =>
	Effect.all([compileRuntimePayload(kernelDirectory), embedKernelScripts(kernelDirectory)], {
		discard: true,
	}).pipe(Effect.andThen(compileTrustedRunner(kernelDirectory, sandboxRuntimeDirectory)));

const fingerprintOf = (files: Readonly<Record<string, string>>) =>
	canonicalFileSetHash(Object.entries(files).map(([path, contents]) => ({ path, contents })));

const program = Effect.gen(function* () {
	const path = yield* Path.Path;
	const scriptPath = yield* path.fromFileUrl(new URL(import.meta.url));
	const kernelDirectory = path.resolve(path.dirname(scriptPath), "..");
	const sandboxRuntimeDirectory = path.resolve(
		kernelDirectory,
		"src",
		"lib",
		"infrastructure",
		"sandbox-runtime",
	);
	if (!process.argv.includes("--skip-initial")) {
		yield* generateRuntime(kernelDirectory, sandboxRuntimeDirectory);
	}
	if (!process.argv.includes("--watch")) {
		return yield* Effect.void;
	}

	const sources = yield* sandboxRuntimeInputs(kernelDirectory, sandboxRuntimeDirectory);
	const currentFingerprint = yield* Ref.make(fingerprintOf(sources));
	return yield* Effect.gen(function* () {
		yield* Effect.sleep("250 millis");
		const nextSources = yield* sandboxRuntimeInputs(kernelDirectory, sandboxRuntimeDirectory);
		const nextFingerprint = fingerprintOf(nextSources);
		if (nextFingerprint !== (yield* Ref.get(currentFingerprint))) {
			const compiled = yield* Effect.result(
				generateRuntime(kernelDirectory, sandboxRuntimeDirectory),
			);
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
