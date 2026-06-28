#!/usr/bin/env bun

import { BunFileSystem, BunPath, BunRuntime } from "@effect/platform-bun";
import { createSha256Hasher } from "@ryot-app/ts-utils/crypto";
import { Data, Effect, Layer, Ref, Schema, FileSystem, Path } from "effect";

class RunnerGenerationError extends Data.TaggedError("RunnerGenerationError")<{
	message: string;
}> {}

const encodeGeneratedString = Schema.encodeSync(Schema.fromJsonString(Schema.String));

const walkSandboxSources = (
	directory: string,
	root: string,
): Effect.Effect<Readonly<Record<string, string>>, unknown, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const files: Record<string, string> = {};
		for (const entry of (yield* fs.readDirectory(directory)).sort()) {
			const absolutePath = path.join(directory, entry);
			const info = yield* fs.stat(absolutePath);
			if (info.type === "Directory") {
				Object.assign(files, yield* walkSandboxSources(absolutePath, root));
			} else if (entry.endsWith(".sandbox.ts")) {
				const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
				files[relativePath] = yield* fs.readFileString(absolutePath);
			}
		}
		return files;
	});

const embedKernelScripts = (kernelDirectory: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const scripts = yield* walkSandboxSources(
			path.join(kernelDirectory, "src/modules/definition-registry/kernel-scripts"),
			kernelDirectory,
		);
		const entries = Object.entries(scripts)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(
				([entry, source]) => `\t${encodeGeneratedString(entry)}: ${encodeGeneratedString(source)},`,
			)
			.join("\n");
		yield* fs.writeFileString(
			path.join(kernelDirectory, "src/modules/definition-registry/kernel-scripts.generated.ts"),
			`export const kernelScriptSources = {\n${entries}\n} as const;\n`,
		);
		yield* Effect.logInfo("Embedded kernel sandbox scripts");
	});

const compileRunner = (sandboxRuntimeDirectory: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const entrypoint = `${sandboxRuntimeDirectory}/runner-source.sandbox.ts`;
		const result = yield* Effect.tryPromise({
			try: () =>
				Bun.build({
					format: "esm",
					minify: false,
					splitting: false,
					target: "browser",
					packages: "bundle",
					entrypoints: [entrypoint],
					external: ["@ryot-app/sandbox-sdk/effect"],
				}),
			catch: (error) =>
				new RunnerGenerationError({ message: `Sandbox runner build failed: ${String(error)}` }),
		});
		const [output, ...rest] = result.outputs;
		if (!result.success || !output || rest.length > 0) {
			const details = result.logs.map(({ message }) => message).join("\n");
			return yield* new RunnerGenerationError({
				message: details || "Sandbox runner build did not emit exactly one module",
			});
		}
		const javascript = yield* Effect.promise(() => output.text());
		yield* fs.writeFileString(
			`${sandboxRuntimeDirectory}/runner.generated.ts`,
			`export const sandboxRunnerSource = ${encodeGeneratedString(javascript)};\n`,
		);
		yield* Effect.logInfo("Compiled Deno sandbox runner");
		return yield* Effect.void;
	});

const fingerprint = (files: Readonly<Record<string, string>>) => {
	const hasher = createSha256Hasher();
	for (const [path, source] of Object.entries(files).sort(([left], [right]) =>
		left.localeCompare(right),
	)) {
		hasher.update(`${path.length}:${path}:${source.length}:`);
		hasher.update(source);
	}
	return hasher.digest("hex");
};

const program = Effect.gen(function* () {
	const path = yield* Path.Path;
	const scriptPath = yield* path.fromFileUrl(new URL(import.meta.url));
	const kernelDirectory = path.resolve(path.dirname(scriptPath), "..");
	const kernelScriptsDirectory = path.join(
		kernelDirectory,
		"src/modules/definition-registry/kernel-scripts",
	);
	const sandboxRuntimeDirectory = path.resolve(
		kernelDirectory,
		"src",
		"lib",
		"infrastructure",
		"sandbox-runtime",
	);
	if (!process.argv.includes("--skip-initial")) {
		yield* Effect.all(
			[compileRunner(sandboxRuntimeDirectory), embedKernelScripts(kernelDirectory)],
			{ discard: true },
		);
	}
	if (!process.argv.includes("--watch")) {
		return yield* Effect.void;
	}

	const sources = {
		...(yield* walkSandboxSources(sandboxRuntimeDirectory, sandboxRuntimeDirectory)),
		...(yield* walkSandboxSources(kernelScriptsDirectory, kernelDirectory)),
	};
	const currentFingerprint = yield* Ref.make(fingerprint(sources));
	return yield* Effect.gen(function* () {
		yield* Effect.sleep("250 millis");
		const nextSources = {
			...(yield* walkSandboxSources(sandboxRuntimeDirectory, sandboxRuntimeDirectory)),
			...(yield* walkSandboxSources(kernelScriptsDirectory, kernelDirectory)),
		};
		const nextFingerprint = fingerprint(nextSources);
		if (nextFingerprint !== (yield* Ref.get(currentFingerprint))) {
			const compiled = yield* Effect.result(
				Effect.all([compileRunner(sandboxRuntimeDirectory), embedKernelScripts(kernelDirectory)], {
					discard: true,
				}),
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
	program.pipe(Effect.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))),
);
