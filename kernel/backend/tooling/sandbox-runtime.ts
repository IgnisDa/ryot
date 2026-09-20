#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { compilePluginSandboxSourceEntries } from "@ryot-app/sandbox-compiler/plugins";
import { sandboxRuntimeInputs } from "@ryot-app/sandbox-compiler/runtime-build/inputs";
import { buildSandboxRuntimePayload } from "@ryot-app/sandbox-compiler/runtime-build/payload";
import { walkSourceFiles } from "@ryot-app/sandbox-compiler/runtime-build/source-tree";
import { canonicalFileSetHash } from "@ryot-app/ts-utils/crypto";
import { encodeJsonString } from "@ryot-app/ts-utils/json";
import { buildDenoEsm, ViteBuildService } from "@ryot-app/vite-compiler";
import { Data, Effect, FileSystem, Layer, Path, Ref, Schema } from "effect";

import type { SandboxRuntimePayload } from "../src/lib/infrastructure/sandbox-runtime/payload";
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
			`// oxlint-disable perfectionist/sort-objects -- generated compiler metadata preserves authored field order.\nexport const kernelScriptCompiledOutputs = ${encodeJson(outputs)} as const;\n`,
		);
		yield* Effect.logInfo("Embedded kernel sandbox scripts");
	});

const compileRunner = (sandboxRuntimeDirectory: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const sources = yield* walkSourceFiles(
			sandboxRuntimeDirectory,
			sandboxRuntimeDirectory,
			sandboxSource,
		);
		const { javascript } = yield* buildDenoEsm({
			outputFile: "runner.mjs",
			entry: "runner-source.sandbox.ts",
			approvedDynamicImportExpressions: new Set(["payload.moduleUrl"]),
			approvedExternalSpecifiers: new Set(["effect", "@ryot-app/sandbox-sdk/effect"]),
			sources: Object.entries(sources).map(([path, contents]) => ({ path, contents })),
			aliases: [
				{
					find: "@ryot-app/contract/modules/sandbox/boundary-reason",
					replacement: Bun.resolveSync(
						"@ryot-app/contract/modules/sandbox/boundary-reason",
						import.meta.dir,
					),
				},
				{
					find: "@ryot-app/contract/modules/plugins/execution-metadata",
					replacement: Bun.resolveSync(
						"@ryot-app/contract/modules/plugins/execution-metadata",
						import.meta.dir,
					),
				},
			],
		}).pipe(
			Effect.mapError(
				(error) =>
					new RunnerGenerationError({ message: `Sandbox runner build failed: ${error.message}` }),
			),
		);
		yield* fs.writeFileString(
			`${sandboxRuntimeDirectory}/runner.generated.ts`,
			`export const sandboxRunnerSource = ${encodeJsonString(javascript)};\n`,
		);
		yield* Effect.logInfo("Compiled Deno sandbox runner");
	});

const compileRuntimePayload = (kernelDirectory: string, sandboxRuntimeDirectory: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const payload: SandboxRuntimePayload = yield* buildSandboxRuntimePayload(kernelDirectory).pipe(
			Effect.mapError(
				(error) =>
					new RunnerGenerationError({
						message: `Trusted sandbox runtime build failed: ${error.message}`,
					}),
			),
		);
		yield* fs.writeFileString(
			`${sandboxRuntimeDirectory}/runtime-payload.generated.ts`,
			`export const sandboxRuntimePayload = ${encodeJson(payload)} as const;\n`,
		);
		yield* fs.writeFileString(
			`${sandboxRuntimeDirectory}/runtime-payload-metadata.generated.ts`,
			`export const sandboxRuntimePayloadMetadata = ${encodeJson({ metadata: payload.metadata, contentHash: payload.contentHash })} as const;\n`,
		);
		yield* Effect.logInfo("Compiled trusted Deno runtime payload");
	});

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
		yield* Effect.all(
			[
				compileRunner(sandboxRuntimeDirectory),
				compileRuntimePayload(kernelDirectory, sandboxRuntimeDirectory),
				embedKernelScripts(kernelDirectory),
			],
			{ discard: true },
		);
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
				Effect.all(
					[
						compileRunner(sandboxRuntimeDirectory),
						compileRuntimePayload(kernelDirectory, sandboxRuntimeDirectory),
						embedKernelScripts(kernelDirectory),
					],
					{ discard: true },
				),
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
