#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { pluginClientFileExtension } from "@ryot/contract/modules/plugins/client";
import { PluginManifest as PluginManifestSchema } from "@ryot/contract/modules/plugins/manifest";
import { writePluginArchive } from "@ryot/plugin-archive";
import { Data, Effect, FileSystem, Option, Path, Schema, Stream } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

class BuildError extends Data.TaggedError("BuildError")<{
	readonly message: string;
}> {}

const PackageJson = Schema.Struct({
	exports: Schema.optional(
		Schema.Struct({
			".": Schema.optional(Schema.Struct({ default: Schema.optional(Schema.String) })),
		}),
	),
});

type BuildOptions = {
	readonly cwd: string;
	readonly output: string | undefined;
};

type PluginManifest = Schema.Schema.Type<typeof PluginManifestSchema>;

type SourceFile = { readonly path: string; readonly contents: Uint8Array };

const isWithin = (path: Path.Path, root: string, candidate: string) => {
	const relative = path.relative(root, candidate);
	return (
		relative === "" ||
		(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
	);
};

const loadManifest = Effect.fn("loadManifest")(function* (cwd: string) {
	const path = yield* Path.Path;
	const fs = yield* FileSystem.FileSystem;
	const packageJsonPath = path.join(cwd, "package.json");
	const packageJsonSource = yield* fs.readFileString(packageJsonPath);
	const packageJson = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PackageJson))(
		packageJsonSource,
	).pipe(
		Effect.mapError(
			(error) => new BuildError({ message: `Invalid package.json: ${String(error)}` }),
		),
	);
	const manifestEntry = packageJson.exports?.["."]?.default;
	if (manifestEntry === undefined) {
		return yield* new BuildError({
			message: 'package.json must define exports["."].default',
		});
	}

	const manifestPath = path.resolve(cwd, manifestEntry);
	const manifestUrl = yield* path.toFileUrl(manifestPath);
	const manifestModule = yield* Effect.tryPromise({
		try: () => import(`${manifestUrl.href}?cacheBust=${Date.now()}-${Math.random()}`),
		catch: (error) =>
			new BuildError({ message: `Unable to load plugin manifest: ${String(error)}` }),
	});

	return yield* Schema.decodeUnknownEffect(PluginManifestSchema)(manifestModule.default).pipe(
		Effect.mapError(
			(error) => new BuildError({ message: `Invalid plugin manifest: ${String(error)}` }),
		),
	);
});

const collectSources = Effect.fn("collectSources")(function* (cwd: string) {
	const path = yield* Path.Path;
	const fs = yield* FileSystem.FileSystem;
	const backendPaths = yield* Stream.fromAsyncIterable(
		new Bun.Glob("backend/**/*.ts").scan({ cwd, onlyFiles: true }),
		(error) => new BuildError({ message: `Unable to discover backend sources: ${String(error)}` }),
	).pipe(
		Stream.filter((sourcePath) => !sourcePath.endsWith(".test.ts")),
		Stream.map((sourcePath) => path.normalize(sourcePath)),
		Stream.runCollect,
	);
	const clientPaths = yield* Stream.fromAsyncIterable(
		new Bun.Glob("client/**/*").scan({ cwd, onlyFiles: true }),
		(error) => new BuildError({ message: `Unable to discover client sources: ${String(error)}` }),
	).pipe(
		Stream.filter((sourcePath) => pluginClientFileExtension(sourcePath) !== undefined),
		Stream.filter((sourcePath) => !path.basename(sourcePath).includes(".test.")),
		Stream.map((sourcePath) => path.normalize(sourcePath)),
		Stream.runCollect,
	);
	const paths = [...backendPaths, ...clientPaths];

	const sources = yield* Effect.forEach(paths, (sourcePath) =>
		fs
			.readFile(path.join(cwd, sourcePath))
			.pipe(Effect.map((contents) => ({ contents, path: sourcePath }))),
	);
	return sources.sort((left, right) => left.path.localeCompare(right.path));
});

const validateScriptEntries = Effect.fn("validateScriptEntries")(function* (
	manifest: PluginManifest,
	sources: ReadonlyArray<SourceFile>,
	cwd: string,
) {
	const path = yield* Path.Path;
	const sourcePaths = new Set(sources.map(({ path: sourcePath }) => sourcePath));
	for (const script of manifest.scripts) {
		const entry = script.entry;
		const entryPath = path.resolve(cwd, entry);
		if (!entry.startsWith("backend/") || !isWithin(path, cwd, entryPath)) {
			return yield* new BuildError({
				message: `Script entry must stay within backend: ${entry}`,
			});
		}
		const normalizedEntry = path.relative(cwd, entryPath);
		if (!sourcePaths.has(normalizedEntry)) {
			return yield* new BuildError({
				message: `Script entry was not found in backend sources: ${entry}`,
			});
		}
	}
	if (manifest.client !== undefined) {
		const entry = manifest.client.entry;
		const entryPath = path.resolve(cwd, entry);
		if (!entry.startsWith("client/") || !isWithin(path, path.resolve(cwd, "client"), entryPath)) {
			return yield* new BuildError({
				message: `Client entry must stay within client: ${entry}`,
			});
		}
		const normalizedEntry = path.relative(cwd, entryPath);
		if (!sourcePaths.has(normalizedEntry)) {
			return yield* new BuildError({
				message: `Client entry was not found in client sources: ${entry}`,
			});
		}
	}
	return yield* Effect.void;
});

const writeOutput = Effect.fn("writeOutput")(function* (
	output: string,
	manifest: PluginManifest,
	sources: ReadonlyArray<SourceFile>,
) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const temporary = path.join(path.dirname(output), `.${path.basename(output)}.tmp`);
	const archive = writePluginArchive({
		manifest,
		files: Object.fromEntries(
			sources.map(({ contents, path: sourcePath }) => [sourcePath, contents]),
		),
	});
	yield* fs.makeDirectory(path.dirname(output), { recursive: true });
	yield* fs.remove(temporary, { force: true, recursive: true });
	yield* Effect.gen(function* () {
		yield* fs.writeFile(temporary, archive);
		yield* fs.rename(temporary, output);
	}).pipe(
		Effect.ensuring(fs.remove(temporary, { force: true, recursive: true }).pipe(Effect.orDie)),
	);
});

const buildPlugin = Effect.fn("buildPlugin")(function* ({ cwd, output }: BuildOptions) {
	const path = yield* Path.Path;
	const manifest = yield* loadManifest(cwd);
	const sources = yield* collectSources(cwd);
	yield* validateScriptEntries(manifest, sources, cwd);
	yield* writeOutput(
		path.resolve(cwd, output ?? `dist/${manifest.metadata.slug}.zip`),
		manifest,
		sources,
	);
});

const isRelevantAuthoringPath = (
	path: Path.Path,
	cwd: string,
	output: string | undefined,
	filePath: string,
) => {
	const absolutePath = path.resolve(cwd, filePath);
	const rootRelativePath = path.relative(cwd, absolutePath);
	const segments = rootRelativePath.split(path.sep);
	return (
		!segments.includes("node_modules") &&
		!segments.includes("dist") &&
		(output === undefined || !isWithin(path, path.resolve(cwd, output), absolutePath))
	);
};

const collectAuthoringInputs = Effect.fn("collectAuthoringInputs")(function* ({
	cwd,
	output,
}: BuildOptions) {
	const path = yield* Path.Path;
	const fs = yield* FileSystem.FileSystem;
	const sourcePaths = yield* Stream.fromAsyncIterable(
		new Bun.Glob("**/*").scan({ cwd, onlyFiles: true }),
		(error) =>
			new BuildError({ message: `Unable to discover authoring sources: ${String(error)}` }),
	).pipe(
		Stream.map((filePath) => path.normalize(filePath)),
		Stream.filter((filePath) => isRelevantAuthoringPath(path, cwd, output, filePath)),
		Stream.filter(
			(filePath) =>
				filePath.endsWith(".ts") ||
				(filePath.startsWith(`client${path.sep}`) &&
					pluginClientFileExtension(filePath) !== undefined),
		),
		Stream.runCollect,
	);
	const files = [...new Set([...sourcePaths, "package.json"])].sort();
	return yield* Effect.forEach(files, (filePath) =>
		fs
			.readFile(path.join(cwd, filePath))
			.pipe(Effect.map((contents) => ({ contents, path: filePath }))),
	);
});

const fingerprintAuthoringInputs = Effect.fn("fingerprintAuthoringInputs")(function* (
	options: BuildOptions,
) {
	const inputs = yield* collectAuthoringInputs(options);
	return JSON.stringify(inputs);
});

const runBuildChild = Effect.fn("runBuildChild")(function* (options: BuildOptions) {
	const path = yield* Path.Path;
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
	const scriptPath = yield* path.fromFileUrl(new URL(import.meta.url));
	return yield* spawner.exitCode(
		ChildProcess.make(
			process.execPath,
			[
				scriptPath,
				"plugin",
				"build",
				...(options.output === undefined ? [] : ["--output", options.output]),
			],
			{ cwd: options.cwd, stderr: "inherit", stdin: "inherit", stdout: "inherit" },
		),
	);
});

const watchPlugin = Effect.fn("watchPlugin")(function* (options: BuildOptions) {
	const initialExitCode = yield* runBuildChild(options);
	if (initialExitCode !== 0) {
		return yield* new BuildError({
			message: `Initial build failed with exit code ${initialExitCode}`,
		});
	}

	let currentFingerprint = yield* fingerprintAuthoringInputs(options);
	return yield* Effect.forever(
		Effect.gen(function* () {
			yield* Effect.sleep("250 millis");
			const nextFingerprint = yield* fingerprintAuthoringInputs(options);
			if (nextFingerprint === currentFingerprint) {
				return;
			}

			const rebuild = yield* Effect.result(runBuildChild(options));
			if (rebuild._tag === "Success" && rebuild.success === 0) {
				currentFingerprint = nextFingerprint;
				return;
			}
			if (rebuild._tag === "Success") {
				yield* Effect.logError(`Build failed with exit code ${rebuild.success}`);
			} else {
				yield* Effect.logError(`Build failed: ${String(rebuild.failure)}`);
			}
			yield* Effect.sleep("2 seconds");
		}),
	);
});

const buildCommand = Command.make(
	"build",
	{
		watch: Flag.boolean("watch").pipe(Flag.withDefault(false)),
		output: Flag.string("output").pipe(Flag.withSchema(Schema.NonEmptyString), Flag.optional),
	},
	Effect.fn("buildCommand")(function* ({ output, watch }) {
		const options = { cwd: process.cwd(), output: Option.getOrUndefined(output) };
		if (watch) {
			return yield* watchPlugin(options);
		}
		return yield* buildPlugin(options);
	}),
);

const pluginCommand = Command.make("plugin").pipe(Command.withSubcommands([buildCommand]));

const cli = Command.make("ryot").pipe(Command.withSubcommands([pluginCommand]));

const program = Command.run(cli, { version: "0.0.0" });

if (import.meta.main) {
	BunRuntime.runMain(program.pipe(Effect.provide(BunServices.layer)));
}
