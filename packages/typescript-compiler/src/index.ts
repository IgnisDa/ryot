import { Effect, Schema } from "effect";
import type * as ts from "typescript/unstable/ast";
import {
	API,
	type Checker,
	type Diagnostic,
	DiagnosticCategory,
	type Program,
} from "typescript/unstable/async";
import { createVirtualFileSystem, type FileSystem } from "typescript/unstable/fs";

export const TypeScriptCompilerDiagnostic = Schema.Struct({
	code: Schema.String,
	file: Schema.String,
	line: Schema.Finite,
	column: Schema.Finite,
	message: Schema.String,
	length: Schema.optional(Schema.Finite),
	severity: Schema.Literals(["error", "warning", "info"]),
});

export type TypeScriptProjectSources = Readonly<Record<string, string>>;

export type TypeScriptCompilerDiagnostic = Schema.Schema.Type<typeof TypeScriptCompilerDiagnostic>;

export type TypeScriptProjectConfiguration = {
	readonly compilerOptions: Readonly<Record<string, unknown>>;
};

export type TypeScriptProjectOptions = {
	readonly projectKind: string;
	readonly virtualRoot: string;
	readonly tsserverPath: string;
	readonly entries: ReadonlyArray<string>;
	readonly files: TypeScriptProjectSources;
	readonly configuration: TypeScriptProjectConfiguration;
};

export class TypeScriptProjectError extends Schema.TaggedError<
	TypeScriptProjectError,
	{ readonly brand: unique symbol }
>()("TypeScriptProjectError", { message: Schema.String }) {}

export const typeScriptRequest = <A>(request: () => Promise<A>) =>
	Effect.tryPromise({
		try: request,
		catch: (cause) =>
			new TypeScriptProjectError({
				message: `TypeScript request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
			}),
	});

const diagnosticSeverity = (category: DiagnosticCategory) => {
	if (category === DiagnosticCategory.Warning) {
		return "warning" as const;
	}
	if (category === DiagnosticCategory.Message || category === DiagnosticCategory.Suggestion) {
		return "info" as const;
	}
	return "error" as const;
};

const diagnosticMessage = (diagnostic: Diagnostic): string =>
	[diagnostic.text, ...(diagnostic.messageChain ?? []).map(diagnosticMessage)].join("\n");

const normalizeDiagnostic = (
	diagnostic: Diagnostic,
	file: string,
	sourceFile: undefined | ts.SourceFile,
): TypeScriptCompilerDiagnostic => {
	const location = sourceFile?.getLineAndCharacterOfPosition(Math.max(0, diagnostic.pos));
	return {
		file,
		code: `TS${diagnostic.code}`,
		line: (location?.line ?? 0) + 1,
		column: (location?.character ?? 0) + 1,
		message: diagnosticMessage(diagnostic),
		severity: diagnosticSeverity(diagnostic.category),
		...(diagnostic.end > diagnostic.pos ? { length: diagnostic.end - diagnostic.pos } : {}),
	};
};

export type TypeScriptProjectDiagnostics = {
	readonly project: readonly TypeScriptCompilerDiagnostic[];
	readonly environment: readonly TypeScriptCompilerDiagnostic[];
};

export const typeScriptProjectErrors = (
	diagnostics: TypeScriptProjectDiagnostics,
	environmentFailure: TypeScriptCompilerDiagnostic,
): readonly TypeScriptCompilerDiagnostic[] => {
	const errors = (list: readonly TypeScriptCompilerDiagnostic[]) =>
		list.filter(({ severity }) => severity === "error");
	const environment = errors(diagnostics.environment);
	return environment.length > 0
		? [environmentFailure, ...environment]
		: errors(diagnostics.project);
};

export const resolveTypeScriptCompilerPath = (from: string) => {
	const typescriptPackage = Bun.resolveSync("typescript/package.json", from);
	const typescriptDirectory = typescriptPackage.slice(0, typescriptPackage.lastIndexOf("/"));
	const nativePackage = `@typescript/typescript-${process.platform}-${process.arch}`;
	const nativePackageJson = Bun.resolveSync(`${nativePackage}/package.json`, typescriptDirectory);
	const nativeDirectory = nativePackageJson.slice(0, nativePackageJson.lastIndexOf("/"));
	return `${nativeDirectory}/lib/tsc${process.platform === "win32" ? ".exe" : ""}`;
};

export type TypeScriptProjectAccess = {
	readonly checker: Checker;
	readonly program: Program;
	readonly sourceFiles: readonly ts.SourceFile[];
	readonly diagnostics: TypeScriptProjectDiagnostics;
	readonly entrySourceFiles: Readonly<Record<string, ts.SourceFile>>;
};

export const withTypeScriptProject = <A, E, R>(
	options: TypeScriptProjectOptions,
	use: (project: TypeScriptProjectAccess) => Effect.Effect<A, E, R>,
) => {
	const virtualConfigFile = `${options.virtualRoot}/tsconfig.json`;
	const virtualPath = (path: string) => `${options.virtualRoot}/${path}`;
	const isVirtualPath = (path: string) =>
		path === options.virtualRoot || path.startsWith(`${options.virtualRoot}/`);
	const sourceFiles = Object.fromEntries(
		Object.entries(options.files).map(([path, source]) => [virtualPath(path), source]),
	);
	const virtual = createVirtualFileSystem({
		...sourceFiles,
		[virtualConfigFile]: JSON.stringify({
			files: options.entries.map(virtualPath),
			...options.configuration,
		}),
	});
	const fs = {
		realpath: (path) => (isVirtualPath(path) ? path : undefined),
		readFile: (path) => (isVirtualPath(path) ? virtual.readFile?.(path) : undefined),
		fileExists: (path) => (isVirtualPath(path) ? virtual.fileExists?.(path) : undefined),
		directoryExists: (path) => (isVirtualPath(path) ? virtual.directoryExists?.(path) : undefined),
		getAccessibleEntries: (path) =>
			isVirtualPath(path) ? virtual.getAccessibleEntries?.(path) : undefined,
	} satisfies FileSystem;

	return Effect.acquireUseRelease(
		Effect.sync(() => new API({ fs, cwd: "/", tsserverPath: options.tsserverPath })),
		(api) =>
			Effect.gen(function* () {
				const snapshot = yield* typeScriptRequest(() =>
					api.updateSnapshot({ openProjects: [virtualConfigFile] }),
				);
				const project = snapshot.getProject(virtualConfigFile);
				if (!project) {
					return yield* new TypeScriptProjectError({
						message: `TypeScript did not create the ${options.projectKind} project`,
					});
				}

				const program = project.program;
				const loadedSourceFiles = yield* Effect.forEach(Object.keys(options.files), (path) =>
					typeScriptRequest(() => program.getSourceFile(virtualPath(path))),
				);
				const files = loadedSourceFiles.filter((file) => file !== undefined);
				const entrySourceFiles = Object.fromEntries(
					options.entries.flatMap((entry) => {
						const file = files.find((sourceFile) => sourceFile.fileName === virtualPath(entry));
						return file ? [[entry, file]] : [];
					}),
				);
				if (Object.keys(entrySourceFiles).length !== options.entries.length) {
					return yield* new TypeScriptProjectError({
						message: `TypeScript did not load every ${options.projectKind} entry file`,
					});
				}

				const projectDiagnostics = yield* Effect.all(
					[
						typeScriptRequest(() => program.getProgramDiagnostics()),
						typeScriptRequest(() => program.getGlobalDiagnostics()),
						typeScriptRequest(() => program.getSemanticDiagnostics()),
						typeScriptRequest(() => program.getConfigFileParsingDiagnostics()),
					],
					{ concurrency: "unbounded" },
				);
				const fileDiagnostics = yield* Effect.forEach(files, (file) =>
					Effect.all(
						[
							typeScriptRequest(() => program.getBindDiagnostics(file.fileName)),
							typeScriptRequest(() => program.getSyntacticDiagnostics(file.fileName)),
						],
						{ concurrency: "unbounded" },
					),
				);

				const diagnostics = [...projectDiagnostics.flat(), ...fileDiagnostics.flat(2)];
				const loadedFileNames = new Set(files.map(({ fileName }) => fileName));
				const dependencyFiles = yield* Effect.forEach(
					new Set(
						diagnostics.flatMap(({ fileName }) =>
							fileName && !loadedFileNames.has(fileName) ? [fileName] : [],
						),
					),
					(fileName) => typeScriptRequest(() => program.getSourceFile(fileName)),
				);
				const sourceFilesByName = new Map(
					[...files, ...dependencyFiles.filter((file) => file !== undefined)].map((file) => [
						file.fileName,
						file,
					]),
				);
				const projectFileDiagnostics: TypeScriptCompilerDiagnostic[] = [];
				const environmentDiagnostics: TypeScriptCompilerDiagnostic[] = [];
				for (const diagnostic of diagnostics) {
					const { fileName } = diagnostic;
					const sourceFile = fileName ? sourceFilesByName.get(fileName) : undefined;
					if (fileName && isVirtualPath(fileName)) {
						projectFileDiagnostics.push(
							normalizeDiagnostic(
								diagnostic,
								fileName.slice(options.virtualRoot.length + 1),
								sourceFile,
							),
						);
					} else {
						environmentDiagnostics.push(
							normalizeDiagnostic(diagnostic, fileName ?? "tsconfig.json", sourceFile),
						);
					}
				}

				return yield* use({
					program,
					entrySourceFiles,
					sourceFiles: files,
					checker: project.checker,
					diagnostics: { project: projectFileDiagnostics, environment: environmentDiagnostics },
				});
			}),
		(api) => Effect.promise(() => api.close()),
	);
};

export const createTypeScriptProject = (options: TypeScriptProjectOptions) =>
	withTypeScriptProject(options, ({ diagnostics, sourceFiles, entrySourceFiles }) =>
		Effect.succeed({ diagnostics, sourceFiles, entrySourceFiles }),
	);
