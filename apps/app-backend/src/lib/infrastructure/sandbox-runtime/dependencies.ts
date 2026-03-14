import { SANDBOX_RUNTIME_SDK_IMPORTS, SANDBOX_SDK_ROOT_IMPORT } from "@ryot/sandbox-sdk/imports";
import { createSha256Hasher } from "@ryot/ts-utils/crypto";
import { Data, Effect, FileSystem, Path } from "effect";

class SandboxRuntimeDependencyError extends Data.TaggedError("SandboxRuntimeDependencyError")<{
	message: string;
}> {}

const SANDBOX_RUNTIME_DEPENDENCY_FORMAT = 1 as const;

export const SANDBOX_APPROVED_DEPENDENCIES = [
	{
		name: "effect",
		version: "4.0.0-beta.105",
		runtimeFile: "effect-4.0.0-beta.105.mjs",
		sdkImport: SANDBOX_RUNTIME_SDK_IMPORTS[0],
	},
	{
		name: "cheerio",
		version: "1.2.0",
		runtimeFile: "cheerio-1.2.0.mjs",
		sdkImport: SANDBOX_RUNTIME_SDK_IMPORTS[1],
	},
	{
		name: "youtubei",
		version: "17.2.0",
		runtimeFile: "youtubei-17.2.0.mjs",
		sdkImport: SANDBOX_RUNTIME_SDK_IMPORTS[2],
	},
	{
		name: "fflate",
		version: "0.8.3",
		runtimeFile: "fflate-0.8.3.mjs",
		sdkImport: SANDBOX_RUNTIME_SDK_IMPORTS[3],
	},
	{
		version: "5.5.3",
		name: "papaparse",
		runtimeFile: "papaparse-5.5.3.mjs",
		sdkImport: SANDBOX_RUNTIME_SDK_IMPORTS[4],
	},
	{
		version: "5.8.0",
		name: "fast-xml-parser",
		runtimeFile: "fast-xml-parser-5.8.0.mjs",
		sdkImport: SANDBOX_RUNTIME_SDK_IMPORTS[5],
	},
] as const;

const legacyYoutubeiRuntime = {
	version: "17.2.0",
	name: "youtubei-legacy-deno",
	packageImport: "youtubei.js/package.json",
	entryRelativePath: "dist/src/platform/deno.js",
} as const;

const runtimeModules = SANDBOX_APPROVED_DEPENDENCIES.map((dependency) =>
	dependency.name === "youtubei"
		? {
				...dependency,
				...legacyYoutubeiRuntime,
				resolveFromSdk: true,
				sourceImport: legacyYoutubeiRuntime.packageImport,
				runtimeSource: 'export * from "@ryot/sandbox-sdk/youtubei";',
			}
		: {
				...dependency,
				resolveFromSdk: false,
				entryRelativePath: null,
				sourceImport: dependency.sdkImport,
				runtimeSource:
					dependency.name === "effect"
						? 'import * as Effect from "effect/Effect"; import * as Schema from "effect/Schema"; import * as DateTime from "effect/DateTime"; import * as Duration from "effect/Duration"; import * as Result from "effect/Result"; import * as Option from "effect/Option"; import * as SchemaGetter from "effect/SchemaGetter"; import * as SchemaIssue from "effect/SchemaIssue"; import * as SchemaTransformation from "effect/SchemaTransformation"; export { DateTime, Duration, Effect, Option, Result, Schema, SchemaGetter, SchemaIssue, SchemaTransformation };'
						: null,
			},
);

const runtimeDirectoryPrefix = `runtime-v${SANDBOX_RUNTIME_DEPENDENCY_FORMAT}-${SANDBOX_APPROVED_DEPENDENCIES.map(
	({ name, version }) => `${name}-${version}`,
).join("_")}`;

const runtimeImportMap = {
	imports: Object.fromEntries(
		runtimeModules.map(({ runtimeFile, sdkImport }) => [sdkImport, `./${runtimeFile}`]),
	),
};

export const SANDBOX_RUNTIME_IMPORT_MAP_CONTENT = `${JSON.stringify(
	runtimeImportMap,
	null,
	"\t",
)}\n`;

const runtimeFiles = runtimeModules.map(({ runtimeFile }) => runtimeFile);
const runtimeModuleDirectoryName = "modules";
const runtimeDirectoryEntries = [
	"import-map.json",
	runtimeModuleDirectoryName,
	...runtimeFiles,
].sort();
const runtimeDirectoryFiles = ["import-map.json", ...runtimeFiles].sort();

export type SandboxRuntimePaths = {
	readonly directory: string;
	readonly importMapPath: string;
	readonly cacheDirectory: string;
	readonly moduleDirectory: string;
};

const sandboxRuntimePaths = (
	denoDir: string,
	contentHash: string,
	suffix = "",
): SandboxRuntimePaths => {
	const directory = `${denoDir}/${runtimeDirectoryPrefix}-${contentHash}${suffix}`;
	return {
		directory,
		importMapPath: `${directory}/import-map.json`,
		cacheDirectory: `${denoDir}/cache-v${SANDBOX_RUNTIME_DEPENDENCY_FORMAT}-${contentHash}`,
		moduleDirectory: `${directory}/${runtimeModuleDirectoryName}`,
	};
};

const runtimeContentHash = (fs: FileSystem.FileSystem, directory: string) =>
	Effect.gen(function* () {
		const entries = (yield* fs.readDirectory(directory)).sort();
		if (
			entries.length !== runtimeDirectoryEntries.length ||
			entries.some((entry, index) => entry !== runtimeDirectoryEntries[index])
		) {
			return yield* new SandboxRuntimeDependencyError({
				message: "Sandbox runtime dependency directory has unexpected files",
			});
		}
		if ((yield* fs.stat(`${directory}/${runtimeModuleDirectoryName}`)).type !== "Directory") {
			return yield* new SandboxRuntimeDependencyError({
				message: "Sandbox runtime module path is not a directory",
			});
		}
		const hasher = createSha256Hasher();
		for (const file of runtimeDirectoryFiles) {
			const contents = yield* fs.readFile(`${directory}/${file}`);
			hasher.update(`${file.length}:${file}:${contents.byteLength}:`);
			hasher.update(contents);
		}
		return hasher.digest("hex");
	});

const runtimeMatches = (
	fs: FileSystem.FileSystem,
	paths: SandboxRuntimePaths,
	contentHash: string,
) =>
	runtimeContentHash(fs, paths.directory).pipe(
		Effect.map((actualHash) => actualHash === contentHash),
		Effect.orElseSucceed(() => false),
	);

const buildRuntimeModule = (
	entrypoint: string,
	outputDirectory: string,
	runtimeFile: string,
	runtimeSource: string | null,
	runtimeSourceResolveDir?: string,
) =>
	Effect.tryPromise({
		try: () =>
			Bun.build({
				format: "esm",
				minify: false,
				splitting: false,
				target: "browser",
				packages: "bundle",
				outdir: outputDirectory,
				naming: { entry: runtimeFile },
				entrypoints: [runtimeSource ? "ryot:sandbox-runtime-dependency" : entrypoint],
				plugins: runtimeSource
					? [
							{
								name: "sandbox-runtime-dependency",
								setup(builder) {
									builder.onResolve({ filter: /^ryot:sandbox-runtime-dependency$/ }, () => ({
										path: runtimeFile,
										namespace: "sandbox-runtime-dependency",
									}));
									builder.onLoad({ filter: /.*/, namespace: "sandbox-runtime-dependency" }, () => ({
										loader: "js",
										contents: runtimeSource,
										resolveDir:
											runtimeSourceResolveDir ?? entrypoint.slice(0, entrypoint.lastIndexOf("/")),
									}));
									builder.onResolve({ filter: /^@ryot\/sandbox-sdk\/effect$/ }, () => ({
										external: true,
										path: "@ryot/sandbox-sdk/effect",
									}));
									if (runtimeFile.startsWith("youtubei-")) {
										builder.onResolve({ filter: /^youtubei\.js\/web$/ }, () => ({
											path: entrypoint,
										}));
									}
								},
							},
						]
					: [],
			}),
		catch: (error) =>
			new SandboxRuntimeDependencyError({
				message: `Sandbox runtime dependency build failed: ${String(error)}`,
			}),
	}).pipe(
		Effect.flatMap((result) => {
			const output = result.outputs.filter(({ kind }) => kind === "entry-point");
			if (!result.success || output.length !== 1 || result.outputs.length !== 1) {
				const details = result.logs.map(({ message }) => message).join("\n");
				return Effect.fail(
					new SandboxRuntimeDependencyError({
						message: details || "Bun did not emit exactly one dependency module",
					}),
				);
			}
			return Effect.void;
		}),
	);

const lockRuntimeDirectory = (fs: FileSystem.FileSystem, paths: SandboxRuntimePaths) =>
	Effect.gen(function* () {
		yield* Effect.forEach(
			[paths.importMapPath, ...runtimeFiles.map((file) => `${paths.directory}/${file}`)],
			(path) => fs.chmod(path, 0o444),
			{ discard: true },
		);
		yield* fs.chmod(paths.directory, 0o555);
	});

const prepareRuntimePaths = (fs: FileSystem.FileSystem, paths: SandboxRuntimePaths) =>
	Effect.gen(function* () {
		yield* fs.makeDirectory(paths.cacheDirectory, { recursive: true });
		yield* lockRuntimeDirectory(fs, paths);
		return paths;
	});

const repairRuntimePaths = (denoDir: string, contentHash: string) =>
	sandboxRuntimePaths(denoDir, contentHash, "-repair");

const randomRepairRuntimePaths = (denoDir: string, contentHash: string) =>
	sandboxRuntimePaths(denoDir, contentHash, `-repair-${crypto.randomUUID()}`);

const findVerifiedRepair = (fs: FileSystem.FileSystem, denoDir: string, contentHash: string) =>
	Effect.gen(function* () {
		const baseName = `${runtimeDirectoryPrefix}-${contentHash}`;
		const entries = yield* fs.readDirectory(denoDir);
		for (const entry of entries.sort()) {
			if (!entry.startsWith(`${baseName}-repair`)) {
				continue;
			}
			const paths = sandboxRuntimePaths(denoDir, contentHash, entry.slice(baseName.length));
			if (yield* runtimeMatches(fs, paths, contentHash)) {
				return paths;
			}
		}
		return null;
	});

const publishRuntimeDirectory = (
	fs: FileSystem.FileSystem,
	denoDir: string,
	temporaryDirectory: string,
	contentHash: string,
) =>
	Effect.gen(function* () {
		const primaryPaths = sandboxRuntimePaths(denoDir, contentHash);
		if (yield* runtimeMatches(fs, primaryPaths, contentHash)) {
			return yield* prepareRuntimePaths(fs, primaryPaths);
		}
		const existingRepair = yield* findVerifiedRepair(fs, denoDir, contentHash);
		if (existingRepair) {
			return yield* prepareRuntimePaths(fs, existingRepair);
		}

		const deterministicRepair = repairRuntimePaths(denoDir, contentHash);
		let destination = primaryPaths;
		if (yield* fs.exists(primaryPaths.directory)) {
			if (yield* runtimeMatches(fs, primaryPaths, contentHash)) {
				return yield* prepareRuntimePaths(fs, primaryPaths);
			}
			destination = deterministicRepair;
			if (yield* fs.exists(deterministicRepair.directory)) {
				if (yield* runtimeMatches(fs, deterministicRepair, contentHash)) {
					return yield* prepareRuntimePaths(fs, deterministicRepair);
				}
				destination = randomRepairRuntimePaths(denoDir, contentHash);
			}
		}
		const paths = yield* fs.rename(temporaryDirectory, destination.directory).pipe(
			Effect.as(destination),
			Effect.catch(() =>
				Effect.gen(function* () {
					if (yield* runtimeMatches(fs, primaryPaths, contentHash)) {
						return primaryPaths;
					}
					const repairWinner = yield* findVerifiedRepair(fs, denoDir, contentHash);
					if (repairWinner) {
						return repairWinner;
					}
					const repairPaths = randomRepairRuntimePaths(denoDir, contentHash);
					yield* fs.rename(temporaryDirectory, repairPaths.directory);
					return repairPaths;
				}),
			),
		);
		return yield* prepareRuntimePaths(fs, paths);
	});

export const ensureSandboxRuntimeDependencies = (denoDir: string) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const fs = yield* FileSystem.FileSystem;
		yield* fs.makeDirectory(denoDir, { recursive: true });

		const from = yield* path.fromFileUrl(new URL(".", import.meta.url));
		const sdkEntry = yield* Effect.try({
			try: () => Bun.resolveSync(SANDBOX_SDK_ROOT_IMPORT, from),
			catch: (error) =>
				new SandboxRuntimeDependencyError({
					message: `Sandbox SDK could not be resolved: ${String(error)}`,
				}),
		});
		const sdkDirectory = sdkEntry.slice(0, sdkEntry.lastIndexOf("/"));
		const entries = yield* Effect.forEach(runtimeModules, (runtimeModule) =>
			Effect.try({
				try: () => {
					const resolved = Bun.resolveSync(
						runtimeModule.sourceImport,
						runtimeModule.resolveFromSdk ? sdkDirectory : from,
					);
					const entrypoint = runtimeModule.entryRelativePath
						? `${resolved.slice(0, resolved.lastIndexOf("/"))}/${runtimeModule.entryRelativePath}`
						: resolved;
					return {
						entrypoint,
						runtimeFile: runtimeModule.runtimeFile,
						runtimeSource: runtimeModule.runtimeSource,
					};
				},
				catch: (error) =>
					new SandboxRuntimeDependencyError({
						message: `Sandbox runtime dependency ${runtimeModule.name}@${runtimeModule.version} could not be resolved: ${String(error)}`,
					}),
			}),
		);

		return yield* Effect.acquireUseRelease(
			fs.makeTempDirectory({ directory: denoDir, prefix: ".ryot-sandbox-runtime-" }),
			(temporaryDirectory) =>
				Effect.gen(function* () {
					yield* fs.makeDirectory(`${temporaryDirectory}/${runtimeModuleDirectoryName}`);
					yield* Effect.forEach(
						entries,
						({ entrypoint, runtimeFile, runtimeSource }) =>
							buildRuntimeModule(
								entrypoint,
								temporaryDirectory,
								runtimeFile,
								runtimeSource,
								runtimeSource ? from : undefined,
							),
						{ discard: true },
					);
					yield* fs.writeFileString(
						`${temporaryDirectory}/import-map.json`,
						SANDBOX_RUNTIME_IMPORT_MAP_CONTENT,
					);
					const contentHash = yield* runtimeContentHash(fs, temporaryDirectory);
					return yield* publishRuntimeDirectory(fs, denoDir, temporaryDirectory, contentHash);
				}),
			(temporaryDirectory) =>
				fs.remove(temporaryDirectory, { recursive: true }).pipe(Effect.ignore),
		);
	});
