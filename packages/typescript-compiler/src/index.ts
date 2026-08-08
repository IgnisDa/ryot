import { Data, Effect, Schema } from "effect";
import type * as ts from "typescript/unstable/ast";
import { API, DiagnosticCategory, type Diagnostic } from "typescript/unstable/async";
import { createVirtualFileSystem, type FileSystem } from "typescript/unstable/fs";

export const TypeScriptCompilerDiagnostic = Schema.Struct({
	code: Schema.String,
	file: Schema.String,
	line: Schema.Number,
	column: Schema.Number,
	message: Schema.String,
	length: Schema.optional(Schema.Number),
	severity: Schema.Literals(["error", "warning", "info"]),
});

export type TypeScriptCompilerDiagnostic = Schema.Schema.Type<typeof TypeScriptCompilerDiagnostic>;

export type TypeScriptProjectSources = Readonly<Record<string, string>>;

export type TypeScriptProjectOptions = {
	readonly projectKind: string;
	readonly virtualRoot: string;
	readonly tsserverPath: string;
	readonly entries: ReadonlyArray<string>;
	readonly files: TypeScriptProjectSources;
	readonly compilerOptions: Readonly<Record<string, unknown>>;
};

export class TypeScriptProjectError extends Data.TaggedError("TypeScriptProjectError")<{
	message: string;
}> {}

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

export const normalizeTypeScriptDiagnostic = (
	diagnostic: Diagnostic,
	files: readonly ts.SourceFile[],
	fallbackFile: ts.SourceFile,
	logicalFile: (fileName: string) => string,
): TypeScriptCompilerDiagnostic => {
	const file =
		files.find((sourceFile) => sourceFile.fileName === diagnostic.fileName) ?? fallbackFile;
	const start = Math.max(0, diagnostic.pos);
	const location = diagnostic.fileName ? file.getLineAndCharacterOfPosition(start) : undefined;

	return {
		code: `TS${diagnostic.code}`,
		line: (location?.line ?? 0) + 1,
		column: (location?.character ?? 0) + 1,
		message: diagnosticMessage(diagnostic),
		severity: diagnosticSeverity(diagnostic.category),
		file: logicalFile(diagnostic.fileName ?? fallbackFile.fileName),
		...(diagnostic.end > diagnostic.pos ? { length: diagnostic.end - diagnostic.pos } : {}),
	};
};

export const resolveTypeScriptCompilerPath = (from: string) => {
	const typescriptPackage = Bun.resolveSync("typescript/package.json", from);
	const typescriptDirectory = typescriptPackage.slice(0, typescriptPackage.lastIndexOf("/"));
	const nativePackage = `@typescript/typescript-${process.platform}-${process.arch}`;
	const nativePackageJson = Bun.resolveSync(`${nativePackage}/package.json`, typescriptDirectory);
	const nativeDirectory = nativePackageJson.slice(0, nativePackageJson.lastIndexOf("/"));
	return `${nativeDirectory}/lib/tsc${process.platform === "win32" ? ".exe" : ""}`;
};

export const createTypeScriptProject = (options: TypeScriptProjectOptions) => {
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
			compilerOptions: options.compilerOptions,
		}),
	});
	const fs = {
		readFile: (path) => (isVirtualPath(path) ? virtual.readFile?.(path) : undefined),
		fileExists: (path) => (isVirtualPath(path) ? virtual.fileExists?.(path) : undefined),
		directoryExists: (path) => (isVirtualPath(path) ? virtual.directoryExists?.(path) : undefined),
		getAccessibleEntries: (path) =>
			isVirtualPath(path) ? virtual.getAccessibleEntries?.(path) : undefined,
		realpath: (path) => (isVirtualPath(path) ? path : undefined),
	} satisfies FileSystem;

	return Effect.acquireUseRelease(
		Effect.sync(() => new API({ cwd: "/", fs, tsserverPath: options.tsserverPath })),
		(api) =>
			Effect.gen(function* () {
				const snapshot = yield* Effect.tryPromise(() =>
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
					Effect.tryPromise(() => program.getSourceFile(virtualPath(path))),
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
						Effect.tryPromise(() => program.getProgramDiagnostics()),
						Effect.tryPromise(() => program.getGlobalDiagnostics()),
						Effect.tryPromise(() => program.getConfigFileParsingDiagnostics()),
					],
					{ concurrency: "unbounded" },
				);
				const fileDiagnostics = yield* Effect.forEach(files, (file) =>
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
					entrySourceFiles,
					sourceFiles: files,
					diagnostics: [...projectDiagnostics.flat(), ...fileDiagnostics.flat(2)],
				};
			}),
		(api) => Effect.promise(() => api.close()),
	);
};
