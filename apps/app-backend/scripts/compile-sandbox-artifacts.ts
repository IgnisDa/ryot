#!/usr/bin/env bun

import { FileSystem, Path } from "@effect/platform";
import { BunFileSystem, BunPath, BunRuntime } from "@effect/platform-bun";
import {
	compileBuiltInSandboxEntries,
	type CompiledBuiltInSandboxEntry,
} from "@ryot/sandbox-compiler/builtins";
import { Data, Effect, Either, Layer, Ref } from "effect";

class BuiltInGenerationError extends Data.TaggedError("BuiltInGenerationError")<{
	message: string;
}> {}

const walkSourceFiles = (
	directory: string,
	root: string,
): Effect.Effect<Readonly<Record<string, string>>, unknown, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const fs = yield* FileSystem.FileSystem;
		const files: Record<string, string> = {};
		for (const entry of (yield* fs.readDirectory(directory)).sort()) {
			if (entry === "node_modules" || entry === "dist" || entry === ".turbo") {
				continue;
			}
			const absolutePath = path.join(directory, entry);
			const info = yield* fs.stat(absolutePath);
			if (info.type === "Directory") {
				Object.assign(files, yield* walkSourceFiles(absolutePath, root));
				continue;
			}
			if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) {
				continue;
			}
			const logicalPath = path.relative(root, absolutePath).split(path.sep).join("/");
			files[logicalPath] = yield* fs.readFileString(absolutePath);
		}
		return files;
	});

const generatedIdentifier = (slug: string) => {
	const separators: Readonly<Record<string, string>> = {
		"-": "Dash",
		".": "Dot",
		_: "Underscore",
	};
	const encoded = slug
		.split(/([._-])/)
		.map((part) => separators[part] ?? `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
		.join("");
	return `sandbox${encoded}Script`;
};

const registrySource = (entries: readonly CompiledBuiltInSandboxEntry[]) => {
	const declarations = entries.map(({ compiled, source }) => {
		const identifier = generatedIdentifier(compiled.manifest.slug);
		const manifest = JSON.stringify(compiled.manifest, null, "\t");
		return `const ${identifier}Source = ${JSON.stringify(source)};
const ${identifier}Manifest: SandboxManifest = ${manifest};

export const ${identifier}: GeneratedSandboxScript = {
\tname: ${JSON.stringify(compiled.manifest.name)},
\tslug: ${JSON.stringify(compiled.manifest.slug)},
\tsource: ${identifier}Source,
\tmanifest: ${identifier}Manifest,
\tcompiledFormat: ${compiled.format},
\tcompiledCode: ${JSON.stringify(compiled.javascript)},
};`;
	});
	const identifiers = entries.map(({ compiled }) => generatedIdentifier(compiled.manifest.slug));
	return `import type { SandboxManifest } from "@ryot/sandbox-sdk/core";

export type GeneratedSandboxScript = {
\tname: string;
\tslug: string;
\tsource: string;
\tmanifest: SandboxManifest;
\tcompiledFormat: 1;
\tcompiledCode: string;
};

${declarations.join("\n\n")}

export const generatedSandboxScripts = [${identifiers.join(", ")}];
`;
};

const walkSourceRoots = (sourceRoots: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const entries = yield* Effect.forEach(sourceRoots, (sourceRoot, index) =>
			walkSourceFiles(sourceRoot, sourceRoot).pipe(
				Effect.map((files) =>
					Object.fromEntries(
						Object.entries(files).map(([path, source]) => [`${index}/${path}`, source]),
					),
				),
			),
		);
		const files: Record<string, string> = {};
		for (const entry of entries) {
			Object.assign(files, entry);
		}
		return files;
	});

const compileSandboxArtifacts = (sourceRoots: ReadonlyArray<string>, outputDirectory: string) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const fs = yield* FileSystem.FileSystem;
		const compiledGroups = yield* Effect.forEach(sourceRoots, (sourceRoot) =>
			Effect.gen(function* () {
				const files = yield* walkSourceFiles(sourceRoot, sourceRoot);
				const entryPaths = Object.keys(files)
					.filter((logicalPath) => logicalPath.endsWith(".sandbox.ts"))
					.sort();
				return yield* compileBuiltInSandboxEntries(entryPaths.map((entry) => ({ entry, files })));
			}),
		);
		const compiled = compiledGroups.flat();
		const slugs = new Set<string>();
		for (const entry of compiled) {
			if (slugs.has(entry.compiled.manifest.slug)) {
				return yield* new BuiltInGenerationError({
					message: `Duplicate generated sandbox slug: ${entry.compiled.manifest.slug}`,
				});
			}
			slugs.add(entry.compiled.manifest.slug);
		}

		yield* fs.makeDirectory(outputDirectory, { recursive: true });
		const expectedFiles = new Set([
			"registry.ts",
			...compiled.map((entry) => `${entry.compiled.manifest.slug}.mjs`),
		]);
		yield* Effect.acquireUseRelease(
			fs.makeTempDirectory({
				prefix: ".generated-sandbox-",
				directory: path.dirname(outputDirectory),
			}),
			(temporaryDirectory) =>
				Effect.gen(function* () {
					for (const entry of compiled) {
						yield* fs.writeFileString(
							`${temporaryDirectory}/${entry.compiled.manifest.slug}.mjs`,
							entry.compiled.javascript,
						);
					}
					yield* fs.writeFileString(`${temporaryDirectory}/registry.ts`, registrySource(compiled));
					for (const entry of compiled) {
						const file = `${entry.compiled.manifest.slug}.mjs`;
						yield* fs.rename(`${temporaryDirectory}/${file}`, `${outputDirectory}/${file}`);
					}
					for (const file of yield* fs.readDirectory(outputDirectory)) {
						if (!expectedFiles.has(file)) {
							yield* fs.remove(`${outputDirectory}/${file}`, { recursive: true });
						}
					}
					yield* fs.rename(`${temporaryDirectory}/registry.ts`, `${outputDirectory}/registry.ts`);
				}),
			(temporaryDirectory) =>
				fs.remove(temporaryDirectory, { recursive: true }).pipe(Effect.ignore),
		);
		yield* Effect.logInfo(`Compiled ${compiled.length} sandbox test module(s)`);
		return yield* walkSourceRoots(sourceRoots);
	}).pipe(Effect.tapError((error) => Effect.logError(JSON.stringify(error, null, 2))));

const runnerModuleSource = (javascript: string) =>
	`export const sandboxRunnerSource = ${JSON.stringify(javascript)};\n`;

const compileRunner = (sandboxRuntimeDir: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const entrypoint = `${sandboxRuntimeDir}/runner-source.sandbox.ts`;
		const result = yield* Effect.tryPromise({
			try: () =>
				Bun.build({
					format: "esm",
					minify: false,
					splitting: false,
					target: "browser",
					packages: "bundle",
					entrypoints: [entrypoint],
					external: ["@ryot/sandbox-sdk/effect"],
				}),
			catch: (error) =>
				new BuiltInGenerationError({ message: `Sandbox runner build failed: ${String(error)}` }),
		});
		const [output, ...rest] = result.outputs;
		if (!result.success || !output || rest.length > 0) {
			const details = result.logs.map(({ message }) => message).join("\n");
			return yield* new BuiltInGenerationError({
				message: details || "Sandbox runner build did not emit exactly one module",
			});
		}
		const javascript = yield* Effect.promise(() => output.text());
		yield* fs.writeFileString(
			`${sandboxRuntimeDir}/runner.generated.ts`,
			runnerModuleSource(javascript),
		);
		yield* Effect.logInfo("Compiled Deno sandbox runner");
		return yield* Effect.void;
	}).pipe(Effect.tapError((error) => Effect.logError(JSON.stringify(error, null, 2))));

const fingerprint = (files: Readonly<Record<string, string>>) => {
	const hasher = new Bun.CryptoHasher("sha256");
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
	const backendRoot = path.resolve(path.dirname(scriptPath), "..");
	const workspaceRoot = path.resolve(backendRoot, "..", "..");
	const sourceRoots = [
		path.join(workspaceRoot, "plugins", "media"),
		path.join(workspaceRoot, "plugins", "fitness"),
		path.join(backendRoot, "src", "modules", "definition-registry", "kernel-scripts"),
	];
	const outputDirectory = path.join(
		backendRoot,
		"src",
		"lib",
		"infrastructure",
		"sandbox-runtime",
		"generated-sandbox",
	);
	const sandboxRuntimeDir = path.join(
		backendRoot,
		"src",
		"lib",
		"infrastructure",
		"sandbox-runtime",
	);
	yield* compileRunner(sandboxRuntimeDir);
	const files = process.argv.includes("--skip-initial")
		? yield* walkSourceRoots(sourceRoots)
		: yield* compileSandboxArtifacts(sourceRoots, outputDirectory);
	if (!process.argv.includes("--watch")) {
		return yield* Effect.void;
	}

	const currentFingerprint = yield* Ref.make(fingerprint(files));
	return yield* Effect.gen(function* () {
		yield* Effect.sleep("250 millis");
		const nextFiles = yield* walkSourceRoots(sourceRoots);
		const nextFingerprint = fingerprint(nextFiles);
		if (nextFingerprint !== (yield* Ref.get(currentFingerprint))) {
			const generated = yield* Effect.either(compileSandboxArtifacts(sourceRoots, outputDirectory));
			if (Either.isRight(generated)) {
				yield* Ref.set(currentFingerprint, fingerprint(generated.right));
			} else {
				yield* Effect.sleep("2 seconds");
			}
		}
	}).pipe(Effect.forever);
});

BunRuntime.runMain(
	program.pipe(Effect.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))),
);
