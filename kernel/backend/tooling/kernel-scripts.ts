#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { compilePluginSandboxSourceEntries } from "@ryot-app/sandbox-compiler/plugins";
import { walkSourceFiles } from "@ryot-app/sandbox-compiler/runtime-build/source-tree";
import { canonicalFileSetHash } from "@ryot-app/ts-utils/crypto";
import { encodeJsonString } from "@ryot-app/ts-utils/json";
import { ViteBuildService } from "@ryot-app/vite-compiler";
import { Effect, FileSystem, Layer, Path, Ref, Schema } from "effect";

import { kernelScripts } from "../src/modules/definition-registry/kernel-source";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const sandboxSource = (file: string) => file.endsWith(".sandbox.ts");

const readKernelScripts = (kernelDirectory: string) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		return yield* walkSourceFiles(
			path.join(kernelDirectory, "src/modules/definition-registry/kernel-scripts"),
			kernelDirectory,
			sandboxSource,
		);
	});

const embedKernelScripts = (kernelDirectory: string, scripts: Readonly<Record<string, string>>) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const registryDirectory = path.join(kernelDirectory, "src/modules/definition-registry");
		const entries = Object.entries(scripts)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([entry, source]) => `\t${encodeJsonString(entry)}: ${encodeJsonString(source)},`)
			.join("\n");
		yield* fs.writeFileString(
			path.join(registryDirectory, "kernel-scripts.generated.ts"),
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
			path.join(registryDirectory, "kernel-scripts.compiled.generated.ts"),
			`export const kernelScriptCompiledOutputs = ${encodeJson(outputs)} as const;\n`,
		);
		yield* Effect.logInfo("Embedded kernel sandbox scripts");
	});

const fingerprintOf = (files: Readonly<Record<string, string>>) =>
	canonicalFileSetHash(Object.entries(files).map(([path, contents]) => ({ path, contents })));

const program = Effect.gen(function* () {
	const path = yield* Path.Path;
	const scriptPath = yield* path.fromFileUrl(new URL(import.meta.url));
	const kernelDirectory = path.resolve(path.dirname(scriptPath), "..");
	const scripts = yield* readKernelScripts(kernelDirectory);
	if (!process.argv.includes("--skip-initial")) {
		yield* embedKernelScripts(kernelDirectory, scripts);
	}
	if (!process.argv.includes("--watch")) {
		return yield* Effect.void;
	}
	const currentFingerprint = yield* Ref.make(fingerprintOf(scripts));
	return yield* Effect.gen(function* () {
		yield* Effect.sleep("250 millis");
		const nextScripts = yield* readKernelScripts(kernelDirectory);
		const nextFingerprint = fingerprintOf(nextScripts);
		if (nextFingerprint !== (yield* Ref.get(currentFingerprint))) {
			const embedded = yield* Effect.result(embedKernelScripts(kernelDirectory, nextScripts));
			if (embedded._tag === "Success") {
				yield* Ref.set(currentFingerprint, nextFingerprint);
			} else {
				yield* Effect.sleep("2 seconds");
			}
		}
	}).pipe(Effect.forever);
}).pipe(Effect.tapError((error) => Effect.logError(JSON.stringify(error, null, 2))));

BunRuntime.runMain(
	// oxlint-disable-next-line effecttsgo/strict-effect-provide -- The kernel script generator is a command-line entrypoint
	program.pipe(Effect.provide(Layer.mergeAll(BunServices.layer, ViteBuildService.layer))),
);
