import { Cause, Context, Effect, Exit, Layer, Option, Schema, Semaphore } from "effect";
import type * as ts from "typescript/unstable/ast";
import {
	API,
	type Checker,
	type Diagnostic,
	DiagnosticCategory,
	type Program,
	type Snapshot,
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

type SessionState = {
	readonly api: API;
	readonly snapshot: Snapshot;
	readonly configFile: string;
	readonly tsserverPath: string;
	readonly files: ReadonlyMap<string, string>;
};

type TypeScriptSessionShape = {
	readonly check: <A, E, R>(
		options: TypeScriptProjectOptions,
		use: (project: TypeScriptProjectAccess) => Effect.Effect<A, E, R>,
	) => Effect.Effect<A, E | TypeScriptProjectError, R>;
};

const fileChanges = (previous: ReadonlyMap<string, string>, next: ReadonlyMap<string, string>) => {
	const changed: string[] = [];
	const created: string[] = [];
	for (const [path, contents] of next) {
		const previousContents = previous.get(path);
		if (previousContents === undefined) {
			created.push(path);
		} else if (previousContents !== contents) {
			changed.push(path);
		}
	}
	const deleted = [...previous.keys()].filter((path) => !next.has(path));
	return { changed, created, deleted };
};

const isUnderRoot = (root: string, path: string) => path === root || path.startsWith(`${root}/`);

const projectFiles = (options: TypeScriptProjectOptions) => {
	const virtualPath = (path: string) => `${options.virtualRoot}/${path}`;
	return new Map([
		...Object.entries(options.files).map(([path, source]) => [virtualPath(path), source] as const),
		[
			`${options.virtualRoot}/tsconfig.json`,
			JSON.stringify({ files: options.entries.map(virtualPath), ...options.configuration }),
		],
	]);
};

const collectDiagnostics = (
	options: TypeScriptProjectOptions,
	program: Program,
	files: readonly ts.SourceFile[],
	checkDependencies: boolean,
) =>
	Effect.gen(function* () {
		const projectDiagnostics = yield* Effect.all(
			[
				typeScriptRequest(() => program.getProgramDiagnostics()),
				typeScriptRequest(() => program.getConfigFileParsingDiagnostics()),
				...(checkDependencies
					? [
							typeScriptRequest(() => program.getGlobalDiagnostics()),
							typeScriptRequest(() => program.getSemanticDiagnostics()),
						]
					: []),
			],
			{ concurrency: "unbounded" },
		);
		const fileDiagnostics = yield* Effect.forEach(files, (file) =>
			Effect.all(
				[
					typeScriptRequest(() => program.getBindDiagnostics(file.fileName)),
					typeScriptRequest(() => program.getSyntacticDiagnostics(file.fileName)),
					...(checkDependencies
						? []
						: [typeScriptRequest(() => program.getSemanticDiagnostics(file.fileName))]),
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
		const project: TypeScriptCompilerDiagnostic[] = [];
		const environment: TypeScriptCompilerDiagnostic[] = [];
		for (const diagnostic of diagnostics) {
			const { fileName } = diagnostic;
			const sourceFile = fileName ? sourceFilesByName.get(fileName) : undefined;
			if (fileName && isUnderRoot(options.virtualRoot, fileName)) {
				project.push(
					normalizeDiagnostic(
						diagnostic,
						fileName.slice(options.virtualRoot.length + 1),
						sourceFile,
					),
				);
			} else {
				environment.push(normalizeDiagnostic(diagnostic, fileName ?? "tsconfig.json", sourceFile));
			}
		}
		return { project, environment } satisfies TypeScriptProjectDiagnostics;
	});

const inspect = <A, E, R>(
	options: TypeScriptProjectOptions,
	checkDependencies: boolean,
	snapshot: Snapshot,
	configFile: string,
	use: (project: TypeScriptProjectAccess) => Effect.Effect<A, E, R>,
) =>
	Effect.gen(function* () {
		const project = snapshot.getProject(configFile);
		if (!project) {
			return yield* new TypeScriptProjectError({
				message: `TypeScript did not create the ${options.projectKind} project`,
			});
		}
		const program = project.program;
		const loadedSourceFiles = yield* Effect.forEach(Object.keys(options.files), (path) =>
			typeScriptRequest(() => program.getSourceFile(`${options.virtualRoot}/${path}`)),
		);
		const files = loadedSourceFiles.filter((file) => file !== undefined);
		const entrySourceFiles = Object.fromEntries(
			options.entries.flatMap((entry) => {
				const file = files.find(
					(sourceFile) => sourceFile.fileName === `${options.virtualRoot}/${entry}`,
				);
				return file ? [[entry, file]] : [];
			}),
		);
		if (Object.keys(entrySourceFiles).length !== options.entries.length) {
			return yield* new TypeScriptProjectError({
				message: `TypeScript did not load every ${options.projectKind} entry file`,
			});
		}
		return yield* use({
			program,
			entrySourceFiles,
			sourceFiles: files,
			checker: project.checker,
			diagnostics: yield* collectDiagnostics(options, program, files, checkDependencies),
		});
	});

const makeTypeScriptSession = (checkDependencies: boolean) =>
	Effect.gen(function* () {
		const lock = yield* Semaphore.make(1);
		let state: undefined | SessionState;
		let virtualRoot: string | undefined;
		let virtual = createVirtualFileSystem({});
		const isVirtualPath = (path: string) =>
			virtualRoot !== undefined && isUnderRoot(virtualRoot, path);
		const fs = {
			realpath: (path) => (isVirtualPath(path) ? path : undefined),
			readFile: (path) => (isVirtualPath(path) ? virtual.readFile?.(path) : undefined),
			fileExists: (path) => (isVirtualPath(path) ? virtual.fileExists?.(path) : undefined),
			directoryExists: (path) =>
				isVirtualPath(path) ? virtual.directoryExists?.(path) : undefined,
			getAccessibleEntries: (path) =>
				isVirtualPath(path) ? virtual.getAccessibleEntries?.(path) : undefined,
		} satisfies FileSystem;
		const close = Effect.suspend(() => {
			const current = state;
			state = undefined;
			return current === undefined ? Effect.void : Effect.promise(() => current.api.close());
		});
		yield* Effect.addFinalizer(() => close);

		const check = <A, E, R>(
			options: TypeScriptProjectOptions,
			use: (project: TypeScriptProjectAccess) => Effect.Effect<A, E, R>,
		) =>
			Effect.gen(function* () {
				const configFile = `${options.virtualRoot}/tsconfig.json`;
				const files = projectFiles(options);
				if (state !== undefined && state.tsserverPath !== options.tsserverPath) {
					yield* close;
				}
				const previous = state;
				const api =
					previous?.api ??
					(yield* Effect.try({
						try: () => new API({ fs, cwd: "/", tsserverPath: options.tsserverPath }),
						catch: (cause) =>
							new TypeScriptProjectError({
								message: `TypeScript could not start: ${cause instanceof Error ? cause.message : String(cause)}`,
							}),
					}));
				virtualRoot = options.virtualRoot;
				virtual = createVirtualFileSystem(Object.fromEntries(files));
				const snapshot = yield* typeScriptRequest(() =>
					api.updateSnapshot(
						previous === undefined
							? { openProjects: [configFile] }
							: {
									fileChanges: fileChanges(previous.files, files),
									...(previous.configFile === configFile
										? {}
										: { openProjects: [configFile], closeProjects: [previous.configFile] }),
								},
					),
				);
				// The server reports changed files only against a live previous snapshot; without
				// them the client would keep serving the previous snapshot's cached syntax trees.
				if (previous !== undefined) {
					yield* Effect.promise(() => previous.snapshot.dispose());
				}
				state = { api, files, snapshot, configFile, tsserverPath: options.tsserverPath };
				return yield* inspect(options, checkDependencies, snapshot, configFile, use);
			}).pipe(
				// A failed or interrupted server request leaves the server's state unknown, so the next
				// check starts a fresh server; failures of the caller's own checks keep the session.
				Effect.onExit((exit) =>
					Exit.isFailure(exit) &&
					(Cause.hasDies(exit.cause) ||
						Cause.hasInterrupts(exit.cause) ||
						Option.exists(
							Cause.findErrorOption(exit.cause),
							(error) => error instanceof TypeScriptProjectError,
						))
						? close
						: Effect.void,
				),
				lock.withPermits(1),
			);

		return { check } satisfies TypeScriptSessionShape;
	});

export class TypeScriptSession extends Context.Service<TypeScriptSession, TypeScriptSessionShape>()(
	"@ryot-app/typescript-compiler/TypeScriptSession",
) {
	static readonly layer = Layer.effect(this, makeTypeScriptSession(false));
	static readonly environmentLayer = Layer.effect(this, makeTypeScriptSession(true));
}

export const withTypeScriptProject = <A, E, R>(
	options: TypeScriptProjectOptions,
	use: (project: TypeScriptProjectAccess) => Effect.Effect<A, E, R>,
) =>
	Effect.gen(function* () {
		const session = yield* TypeScriptSession;
		return yield* session.check(options, use);
	});

export const createTypeScriptProject = (options: TypeScriptProjectOptions) =>
	withTypeScriptProject(options, ({ diagnostics, sourceFiles, entrySourceFiles }) =>
		Effect.succeed({ diagnostics, sourceFiles, entrySourceFiles }),
	);
