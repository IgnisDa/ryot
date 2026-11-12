#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import {
	AuthoredPluginManifest as AuthoredPluginManifestSchema,
	PluginManifest as PluginManifestSchema,
} from "@ryot-app/contract/modules/plugins/manifest";
import type { PluginPackageReference } from "@ryot-app/contract/modules/plugins/references";
import {
	type DefinitionSetPlugin,
	validateDefinitionSet,
} from "@ryot-app/definitions/definition-set";
import { kernelDefinitionSource } from "@ryot-app/definitions/kernel-definitions";
import {
	PluginArchiveError,
	type PluginArchivePackage,
	writePluginArchive,
} from "@ryot-app/plugin-archive";
import type { PluginBackendCompilerDiagnostic } from "@ryot-app/plugin-backend-compiler/diagnostics";
import { pluginBackendCompilerPlatformLayer } from "@ryot-app/plugin-backend-compiler/platform";
import {
	derivePluginSandboxScripts,
	pluginScriptCompileMismatchIssue,
} from "@ryot-app/plugin-backend-compiler/plugin-manifest";
import {
	compileClientPluginModule,
	pluginClientCompilerPlatformLayer,
} from "@ryot-app/plugin-client-compiler";
import {
	clientDeclarationHash,
	isPluginSourceFile,
	type PluginClientArtifact,
	pluginClientFileExtension,
} from "@ryot-app/plugin-client-contract";
import {
	Clock,
	Effect,
	FileSystem,
	Layer,
	Option,
	Path,
	type PlatformError,
	Random,
	Schema,
	Stream,
} from "effect";
import { Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

class BuildError extends Schema.TaggedError<BuildError, { readonly brand: unique symbol }>()(
	"BuildError",
	{ message: Schema.String },
) {}

const PackageDependencies = Schema.optional(Schema.Record(Schema.String, Schema.String));

const PackageJson = Schema.Struct({
	dependencies: PackageDependencies,
	devDependencies: PackageDependencies,
	peerDependencies: PackageDependencies,
	exports: Schema.optional(
		Schema.Struct({
			".": Schema.optional(Schema.Struct({ default: Schema.optional(Schema.String) })),
		}),
	),
});

type PluginManifest = Schema.Schema.Type<typeof PluginManifestSchema>;

type SourceFile = { readonly path: string; readonly contents: Uint8Array };

type BuildOptions = { readonly cwd: string; readonly output: string | undefined };

type AuthoredPluginManifest = Schema.Schema.Type<typeof AuthoredPluginManifestSchema>;

const isWithin = (path: Path.Path, root: string, candidate: string) => {
	const relative = path.relative(root, candidate);
	return (
		relative === "" ||
		(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
	);
};

const readPackageJson = Effect.fn("readPackageJson")(function* (directory: string) {
	const path = yield* Path.Path;
	const fs = yield* FileSystem.FileSystem;
	const source = yield* fs.readFileString(path.join(directory, "package.json"));
	return yield* Schema.decodeEffect(Schema.fromJsonString(PackageJson))(source).pipe(
		Effect.mapError(
			(error) => new BuildError({ message: `Invalid package.json: ${String(error)}` }),
		),
	);
});

const importManifest = Effect.fn("importManifest")(function* (directory: string, entry: string) {
	const path = yield* Path.Path;
	const manifestUrl = yield* path.toFileUrl(path.resolve(directory, entry));
	const cacheBust = yield* Clock.currentTimeMillis;
	const cacheBustNonce = yield* Random.nextInt;
	const manifestModule = yield* Effect.tryPromise({
		catch: (error) =>
			new BuildError({ message: `Unable to load plugin manifest: ${String(error)}` }),
		try: (): Promise<unknown> =>
			import(`${manifestUrl.href}?cacheBust=${cacheBust}-${cacheBustNonce}`),
	});

	return yield* Schema.decodeUnknownEffect(
		Schema.Struct({ default: AuthoredPluginManifestSchema }),
	)(manifestModule).pipe(
		Effect.mapBoth({
			onSuccess: (module) => module.default,
			onFailure: (error) =>
				new BuildError({ message: `Invalid plugin manifest: ${String(error)}` }),
		}),
	);
});

const loadManifest = Effect.fn("loadManifest")(function* (cwd: string) {
	const manifestEntry = (yield* readPackageJson(cwd)).exports?.["."]?.default;
	if (manifestEntry === undefined) {
		return yield* new BuildError({ message: 'package.json must define exports["."].default' });
	}
	return yield* importManifest(cwd, manifestEntry);
});

const findInstalledPackage = Effect.fn("findInstalledPackage")(function* (
	name: string,
	from: string,
) {
	const path = yield* Path.Path;
	const fs = yield* FileSystem.FileSystem;
	for (let directory = from; ; directory = path.dirname(directory)) {
		const candidate = path.join(directory, "node_modules", name);
		if (yield* fs.exists(path.join(candidate, "package.json"))) {
			return Option.some(yield* fs.realPath(candidate));
		}
		if (path.dirname(directory) === directory) {
			return Option.none<string>();
		}
	}
});

const dependencyKey = ({ scope, packageId }: PluginPackageReference) => `${scope}:${packageId}`;

const loadDependencyManifests = Effect.fn("loadDependencyManifests")(function* (
	cwd: string,
	manifest: AuthoredPluginManifest,
) {
	const resolved = new Map<
		string,
		{ readonly manifest: AuthoredPluginManifest; readonly scope: PluginPackageReference["scope"] }
	>();
	const visit = Effect.fnUntraced(function* (
		directory: string,
		importer: AuthoredPluginManifest,
	): Effect.fn.Return<
		void,
		BuildError | PlatformError.PlatformError,
		Path.Path | FileSystem.FileSystem
	> {
		const pending = Object.values(importer.dependencies ?? {}).filter(
			(reference) => !resolved.has(dependencyKey(reference)),
		);
		if (pending.length === 0) {
			return yield* Effect.void;
		}
		const packageJson = yield* readPackageJson(directory);
		const installed = new Map<
			string,
			{ readonly directory: string; readonly manifest: AuthoredPluginManifest }
		>();
		for (const name of Object.keys({
			...packageJson.peerDependencies,
			...packageJson.devDependencies,
			...packageJson.dependencies,
		})) {
			const location = yield* findInstalledPackage(name, directory).pipe(
				Effect.mapError(
					(error) => new BuildError({ message: `Unable to locate ${name}: ${String(error)}` }),
				),
			);
			if (Option.isNone(location)) {
				continue;
			}
			const entry = (yield* readPackageJson(location.value)).exports?.["."]?.default;
			if (entry === undefined) {
				continue;
			}
			const candidate = yield* importManifest(location.value, entry).pipe(Effect.option);
			if (Option.isSome(candidate)) {
				installed.set(candidate.value.metadata.packageId, {
					manifest: candidate.value,
					directory: location.value,
				});
			}
		}
		for (const reference of pending) {
			const dependency = installed.get(reference.packageId);
			if (dependency === undefined) {
				return yield* new BuildError({
					message: `Dependency ${reference.scope} package '${reference.packageId}' is not an installed plugin package`,
				});
			}
			resolved.set(dependencyKey(reference), {
				scope: reference.scope,
				manifest: dependency.manifest,
			});
			yield* visit(dependency.directory, dependency.manifest);
		}
		return yield* Effect.void;
	});
	yield* visit(cwd, manifest);
	return [...resolved.values()];
});

const validateDefinitions = Effect.fn("validateDefinitions")(function* (
	manifest: PluginManifest,
	dependencies: ReadonlyArray<{
		readonly manifest: AuthoredPluginManifest;
		readonly scope: PluginPackageReference["scope"];
	}>,
) {
	// A plugin that depends on a private package can only be installed privately itself.
	const scope = Object.values(manifest.dependencies ?? {}).some(
		(dependency) => dependency.scope === "user",
	)
		? "user"
		: "system";
	const plugins: DefinitionSetPlugin[] = [
		...dependencies.map((dependency) => ({
			scope: dependency.scope,
			manifest: { ...dependency.manifest, scripts: [] },
			id: dependencyKey({ ...dependency, packageId: dependency.manifest.metadata.packageId }),
		})),
		{ scope, manifest, id: dependencyKey({ scope, packageId: manifest.metadata.packageId }) },
	];
	yield* Effect.try({
		try: () => validateDefinitionSet(kernelDefinitionSource(), plugins),
		catch: (error) =>
			new BuildError({
				message: `Invalid plugin definitions: ${error instanceof Error ? error.message : String(error)}`,
			}),
	});
});

const collectSources = Effect.fn("collectSources")(function* (cwd: string) {
	const path = yield* Path.Path;
	const fs = yield* FileSystem.FileSystem;
	const backendPaths = yield* Stream.fromAsyncIterable(
		new Bun.Glob("backend/**/*").scan({ cwd, onlyFiles: true }),
		(error) => new BuildError({ message: `Unable to discover backend sources: ${String(error)}` }),
	).pipe(
		Stream.filter(isPluginSourceFile),
		Stream.map((sourcePath) => path.normalize(sourcePath)),
		Stream.runCollect,
	);
	const sharedPaths = yield* Stream.fromAsyncIterable(
		new Bun.Glob("shared/**/*").scan({ cwd, onlyFiles: true }),
		(error) => new BuildError({ message: `Unable to discover shared sources: ${String(error)}` }),
	).pipe(
		Stream.filter(isPluginSourceFile),
		Stream.map((sourcePath) => path.normalize(sourcePath)),
		Stream.runCollect,
	);
	const clientPaths = yield* Stream.fromAsyncIterable(
		new Bun.Glob("client/**/*").scan({ cwd, onlyFiles: true }),
		(error) => new BuildError({ message: `Unable to discover client sources: ${String(error)}` }),
	).pipe(
		Stream.filter(isPluginSourceFile),
		Stream.map((sourcePath) => path.normalize(sourcePath)),
		Stream.runCollect,
	);
	const paths = [...backendPaths, ...sharedPaths, ...clientPaths];

	const sources = yield* Effect.forEach(paths, (sourcePath) =>
		fs
			.readFile(path.join(cwd, sourcePath))
			.pipe(Effect.map((contents) => ({ contents, path: sourcePath }))),
	);
	return sources.sort((left, right) => left.path.localeCompare(right.path));
});

const backendDecoder = new TextDecoder("utf-8", { fatal: true });

const formatDiagnostic = (diagnostic: PluginBackendCompilerDiagnostic) =>
	`  ${diagnostic.file}:${diagnostic.line}:${diagnostic.column} ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`;

const deriveManifestScripts = Effect.fn("deriveManifestScripts")(function* (
	sources: ReadonlyArray<SourceFile>,
) {
	const files = yield* Effect.try({
		catch: (error) =>
			new BuildError({ message: `Backend source is not valid UTF-8: ${String(error)}` }),
		try: () =>
			Object.fromEntries(
				sources
					.filter(
						({ path: sourcePath }) =>
							sourcePath.startsWith("backend/") || sourcePath.startsWith("shared/"),
					)
					.map(({ contents, path: sourcePath }) => [sourcePath, backendDecoder.decode(contents)]),
			),
	});
	const derived = yield* derivePluginSandboxScripts(files).pipe(
		Effect.catchTags({
			PluginScriptCompileMismatch: (error) =>
				new BuildError({ message: pluginScriptCompileMismatchIssue(error) }),
			PluginBackendCompilerFailure: (error) =>
				new BuildError({
					message: [`${error.message}:`, ...error.diagnostics.map(formatDiagnostic)].join("\n"),
				}),
		}),
	);
	return {
		scripts: derived.map(({ script }) => script),
		compiledScripts: derived.map(({ script, compiled }) => ({
			entry: script.entry,
			format: compiled.format,
			javascript: compiled.javascript,
		})),
	};
});

const compileClientArtifact = Effect.fn("compileClientArtifact")(function* (
	manifest: AuthoredPluginManifest,
	sources: ReadonlyArray<SourceFile>,
) {
	if (manifest.client === undefined) {
		return undefined;
	}
	const files = Object.fromEntries(
		sources
			.filter(
				({ path: sourcePath }) =>
					sourcePath.startsWith("client/") || sourcePath.startsWith("shared/"),
			)
			.map(({ contents, path: sourcePath }) => [sourcePath, contents]),
	);
	return yield* compileClientPluginModule({
		files,
		kind: "plugin",
		name: manifest.metadata.name,
		packageId: manifest.metadata.packageId,
		apiVersion: manifest.client.apiVersion,
		pluginDependencies: manifest.dependencies ?? {},
		clientDeclarationHash: clientDeclarationHash(manifest.client),
		publicExports: Object.fromEntries(
			Object.entries(manifest.client.exports ?? {}).map(([name, declaration]) => [
				name,
				{ kind: declaration.kind, entry: declaration.entry },
			]),
		),
	}).pipe(
		Effect.map(({ artifact }) => artifact),
		Effect.catchTag(
			"PluginClientCompilerFailure",
			(error) =>
				new BuildError({
					message: [`${error.message}:`, ...error.diagnostics.map(formatDiagnostic)].join("\n"),
				}),
		),
	);
});

const writeOutput = Effect.fn("writeOutput")(function* (
	output: string,
	manifest: PluginManifest,
	compiledScripts: PluginArchivePackage["compiledScripts"],
	compiledClient: undefined | PluginClientArtifact,
) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const temporary = path.join(path.dirname(output), `.${path.basename(output)}.tmp`);
	const archive = yield* Effect.try({
		try: () =>
			writePluginArchive({
				manifest,
				compiledScripts,
				...(compiledClient === undefined ? {} : { compiledClient }),
			}),
		catch: (error) =>
			new BuildError({
				message:
					error instanceof PluginArchiveError
						? `Invalid plugin archive: ${error.reason}`
						: `Unable to create plugin archive: ${String(error)}`,
			}),
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
	const authored = yield* loadManifest(cwd);
	const sources = yield* collectSources(cwd);
	const { scripts, compiledScripts } = yield* deriveManifestScripts(sources);
	const compiledClient = yield* compileClientArtifact(authored, sources);
	const manifest = yield* Schema.decodeEffect(PluginManifestSchema)({ ...authored, scripts }).pipe(
		Effect.mapError(
			(error) => new BuildError({ message: `Invalid plugin manifest: ${String(error)}` }),
		),
	);
	yield* validateDefinitions(manifest, yield* loadDependencyManifests(cwd, authored));
	yield* writeOutput(
		path.resolve(cwd, output ?? `dist/${manifest.metadata.packageId}.zip`),
		manifest,
		compiledScripts,
		compiledClient,
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

const sameAuthoringInputs = (left: ReadonlyArray<SourceFile>, right: ReadonlyArray<SourceFile>) =>
	left.length === right.length &&
	left.every(({ path, contents }, index) => {
		const next = right[index];
		if (next === undefined) {
			return false;
		}
		return (
			path === next.path &&
			contents.length === next.contents.length &&
			contents.every((byte, byteIndex) => byte === next.contents[byteIndex])
		);
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
			{ cwd: options.cwd, stdin: "inherit", stderr: "inherit", stdout: "inherit" },
		),
	);
});

const watchPlugin = Effect.fn("watchPlugin")(function* (
	options: BuildOptions,
	skipInitial: boolean,
) {
	let currentInputs = yield* collectAuthoringInputs(options);
	if (!skipInitial) {
		const initialExitCode = yield* runBuildChild(options);
		if (initialExitCode !== 0) {
			return yield* new BuildError({
				message: `Initial build failed with exit code ${initialExitCode}`,
			});
		}
	}

	return yield* Effect.forever(
		Effect.gen(function* () {
			yield* Effect.sleep("250 millis");
			const nextInputs = yield* collectAuthoringInputs(options);
			if (sameAuthoringInputs(nextInputs, currentInputs)) {
				return;
			}

			const rebuild = yield* Effect.result(runBuildChild(options));
			if (rebuild._tag === "Success" && rebuild.success === 0) {
				currentInputs = nextInputs;
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
		watch: Flag.Boolean("watch").pipe(Flag.withDefault(false)),
		skipInitial: Flag.Boolean("skip-initial").pipe(Flag.withDefault(false)),
		output: Flag.String("output").pipe(Flag.withSchema(Schema.NonEmptyString), Flag.optional),
	},
	Effect.fn("buildCommand")(function* ({ watch, output, skipInitial }) {
		const options = { cwd: process.cwd(), output: Option.getOrUndefined(output) };
		if (watch) {
			return yield* watchPlugin(options, skipInitial);
		}
		return yield* buildPlugin(options);
	}),
);

const pluginCommand = Command.make("plugin").pipe(Command.withSubcommands([buildCommand]));

const cli = Command.make("ryot").pipe(Command.withSubcommands([pluginCommand]));

const program = Command.run(cli, { version: "0.0.0" });

if (import.meta.main) {
	BunRuntime.runMain(
		program.pipe(
			Effect.provide(
				Layer.mergeAll(
					BunServices.layer,
					pluginBackendCompilerPlatformLayer,
					pluginClientCompilerPlatformLayer,
				),
			),
		),
	);
}
