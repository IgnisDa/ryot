import { Data, Effect } from "effect";
import { API } from "typescript/unstable/async";
import { createVirtualFileSystem, type FileSystem } from "typescript/unstable/fs";

const virtualRoot = "/__ryot_sandbox__";
const virtualConfigFile = `${virtualRoot}/tsconfig.json`;
const virtualSourceFile = `${virtualRoot}/script.ts`;

class TypeScriptProjectError extends Data.TaggedError("TypeScriptProjectError")<{
	message: string;
}> {}

const isVirtualPath = (path: string) => path === virtualRoot || path.startsWith(`${virtualRoot}/`);

const compilerFileSystem = (source: string, sdkEntries: Readonly<Record<string, string>>) => {
	const virtual = createVirtualFileSystem({
		[virtualSourceFile]: source,
		[virtualConfigFile]: JSON.stringify({
			files: [virtualSourceFile],
			compilerOptions: {
				lib: ["ES2022", "DOM"],
				paths: Object.fromEntries(
					Object.entries(sdkEntries).map(([specifier, entry]) => [specifier, [entry]]),
				),
				types: [],
				module: "ESNext",
				strict: true,
				target: "ES2022",
				noEmit: true,
				skipLibCheck: true,
				isolatedModules: true,
				moduleDetection: "force",
				moduleResolution: "bundler",
				noImplicitReturns: true,
				noUncheckedIndexedAccess: true,
				exactOptionalPropertyTypes: true,
				allowSyntheticDefaultImports: true,
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

export const createTypeScriptProject = (
	source: string,
	sdkEntries: Readonly<Record<string, string>>,
	tsserverPath: string,
) =>
	Effect.acquireUseRelease(
		Effect.sync(
			() =>
				new API({
					cwd: "/",
					tsserverPath,
					fs: compilerFileSystem(source, sdkEntries),
				}),
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
				const sourceFile = yield* Effect.tryPromise(() => program.getSourceFile(virtualSourceFile));
				if (!sourceFile) {
					return yield* new TypeScriptProjectError({
						message: "TypeScript did not load the sandbox source file",
					});
				}

				const diagnostics = (yield* Effect.all(
					[
						Effect.tryPromise(() => program.getProgramDiagnostics()),
						Effect.tryPromise(() => program.getGlobalDiagnostics()),
						Effect.tryPromise(() => program.getConfigFileParsingDiagnostics()),
						Effect.tryPromise(() => program.getBindDiagnostics(virtualSourceFile)),
						Effect.tryPromise(() => program.getSemanticDiagnostics(virtualSourceFile)),
						Effect.tryPromise(() => program.getSyntacticDiagnostics(virtualSourceFile)),
					],
					{ concurrency: "unbounded" },
				)).flat();

				return { sourceFile, diagnostics };
			}),
		(api) => Effect.promise(() => api.close()),
	);
