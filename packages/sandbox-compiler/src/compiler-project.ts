import { Data, Effect } from "effect";
import { API } from "typescript/unstable/async";
import { createVirtualFileSystem, type FileSystem } from "typescript/unstable/fs";

const virtualRoot = "/__ryot_sandbox__";
const virtualConfigFile = `${virtualRoot}/tsconfig.json`;

class TypeScriptProjectError extends Data.TaggedError("TypeScriptProjectError")<{
	message: string;
}> {}

export type SandboxTypeScriptSources = {
	readonly entry: string;
	readonly files: Readonly<Record<string, string>>;
};

const virtualPath = (path: string) => `${virtualRoot}/${path}`;
const isVirtualPath = (path: string) => path === virtualRoot || path.startsWith(`${virtualRoot}/`);

const compilerFileSystem = (
	sources: SandboxTypeScriptSources,
	entries: ReadonlyArray<string>,
	sdkEntries: Readonly<Record<string, string>>,
) => {
	const sourceFiles = Object.fromEntries(
		Object.entries(sources.files).map(([path, source]) => [virtualPath(path), source]),
	);
	const virtual = createVirtualFileSystem({
		...sourceFiles,
		[virtualConfigFile]: JSON.stringify({
			files: entries.map(virtualPath),
			compilerOptions: {
				types: [],
				strict: true,
				noEmit: true,
				target: "ES2022",
				module: "ESNext",
				skipLibCheck: true,
				isolatedModules: true,
				lib: ["ES2022", "DOM"],
				noImplicitReturns: true,
				moduleDetection: "force",
				moduleResolution: "bundler",
				noUncheckedIndexedAccess: true,
				exactOptionalPropertyTypes: true,
				allowSyntheticDefaultImports: true,
				paths: Object.fromEntries(
					Object.entries(sdkEntries).map(([specifier, entry]) => [specifier, [entry]]),
				),
			},
		}),
	});

	return {
		readFile: (path) => (isVirtualPath(path) ? virtual.readFile?.(path) : undefined),
		fileExists: (path) => (isVirtualPath(path) ? virtual.fileExists?.(path) : undefined),
		directoryExists: (path) => (isVirtualPath(path) ? virtual.directoryExists?.(path) : undefined),
		getAccessibleEntries: (path) =>
			isVirtualPath(path) ? virtual.getAccessibleEntries?.(path) : undefined,
		realpath: (path) => (isVirtualPath(path) ? path : undefined),
	} satisfies FileSystem;
};

export const createTypeScriptSourcesProjectForEntries = (
	sources: SandboxTypeScriptSources,
	entries: ReadonlyArray<string>,
	sdkEntries: Readonly<Record<string, string>>,
	tsserverPath: string,
) =>
	Effect.acquireUseRelease(
		Effect.sync(
			() =>
				new API({ cwd: "/", tsserverPath, fs: compilerFileSystem(sources, entries, sdkEntries) }),
		),
		(api) =>
			Effect.gen(function* () {
				const snapshot = yield* Effect.tryPromise(() =>
					api.updateSnapshot({ openProjects: [virtualConfigFile] }),
				);
				const project = snapshot.getProject(virtualConfigFile);
				if (!project) {
					return yield* new TypeScriptProjectError({
						message: "TypeScript did not create the sandbox project",
					});
				}

				const program = project.program;
				const loadedSourceFiles = yield* Effect.forEach(Object.keys(sources.files), (path) =>
					Effect.tryPromise(() => program.getSourceFile(virtualPath(path))),
				);
				const sourceFiles = loadedSourceFiles.filter((file) => file !== undefined);
				const entrySourceFiles = Object.fromEntries(
					entries.flatMap((entry) => {
						const file = sourceFiles.find(
							(sourceFile) => sourceFile.fileName === virtualPath(entry),
						);
						return file ? [[entry, file]] : [];
					}),
				);
				if (Object.keys(entrySourceFiles).length !== entries.length) {
					return yield* new TypeScriptProjectError({
						message: "TypeScript did not load every sandbox entry file",
					});
				}

				const projectDiagnostics = yield* Effect.all(
					[
						Effect.tryPromise(() => program.getProgramDiagnostics()),
						Effect.tryPromise(() => program.getGlobalDiagnostics()),
						Effect.tryPromise(() => program.getConfigFileParsingDiagnostics()),
					],
					{ concurrency: "unbounded" },
				);
				const sourceDiagnostics = yield* Effect.forEach(sourceFiles, (file) =>
					Effect.all(
						[
							Effect.tryPromise(() => program.getBindDiagnostics(file.fileName)),
							Effect.tryPromise(() => program.getSemanticDiagnostics(file.fileName)),
							Effect.tryPromise(() => program.getSyntacticDiagnostics(file.fileName)),
						],
						{ concurrency: "unbounded" },
					),
				);

				return {
					sourceFiles,
					entrySourceFiles,
					diagnostics: [...projectDiagnostics.flat(), ...sourceDiagnostics.flat(2)],
				};
			}),
		(api) => Effect.promise(() => api.close()),
	);

export const createTypeScriptSourcesProject = (
	sources: SandboxTypeScriptSources,
	sdkEntries: Readonly<Record<string, string>>,
	tsserverPath: string,
) =>
	createTypeScriptSourcesProjectForEntries(sources, [sources.entry], sdkEntries, tsserverPath).pipe(
		Effect.flatMap(({ diagnostics, entrySourceFiles, sourceFiles }) => {
			const sourceFile = entrySourceFiles[sources.entry];
			return sourceFile
				? Effect.succeed({ diagnostics, sourceFile, sourceFiles })
				: Effect.fail(
						new TypeScriptProjectError({
							message: "TypeScript did not load the sandbox entry file",
						}),
					);
		}),
	);
