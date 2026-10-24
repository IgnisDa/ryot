import {
	type TypeScriptProjectConfiguration,
	withTypeScriptProject,
} from "@ryot-app/typescript-compiler";
import { Data, Effect } from "effect";
import type * as ts from "typescript/unstable/ast";

import { createSandboxExecutionAnalyzer } from "./compiler-execution";

const virtualRoot = "/__ryot_sandbox__";

export const sandboxTypeScriptProject = {
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
	},
} satisfies TypeScriptProjectConfiguration;

export const sandboxSourcePath = (fileName: string) =>
	fileName.startsWith(`${virtualRoot}/`) ? fileName.slice(virtualRoot.length + 1) : fileName;

class TypeScriptProjectError extends Data.TaggedError("TypeScriptProjectError")<{
	message: string;
}> {}

export type SandboxTypeScriptSources = {
	readonly entry: string;
	readonly files: Readonly<Record<string, string>>;
};

export type SandboxEntryExecution = Effect.Success<
	ReturnType<ReturnType<typeof createSandboxExecutionAnalyzer>>
>;

export type SandboxProjectEntry = {
	readonly entry: string;
	readonly sourceFile: ts.SourceFile;
	readonly execution: SandboxEntryExecution;
};

export const createTypeScriptSourcesProjectForEntries = (
	sources: SandboxTypeScriptSources,
	entries: ReadonlyArray<string>,
	sdkEntries: Readonly<Record<string, string>>,
	tsserverPath: string,
) =>
	withTypeScriptProject(
		{
			entries,
			virtualRoot,
			tsserverPath,
			files: sources.files,
			projectKind: "sandbox",
			configuration: {
				...sandboxTypeScriptProject,
				compilerOptions: {
					...sandboxTypeScriptProject.compilerOptions,
					paths: Object.fromEntries(
						Object.entries(sdkEntries).map(([specifier, entry]) => [specifier, [entry]]),
					),
				},
			},
		},
		(project) =>
			Effect.gen(function* () {
				const analyzeSandboxExecution = createSandboxExecutionAnalyzer(project);
				const projectEntries = yield* Effect.forEach(entries, (entry) =>
					Effect.gen(function* () {
						const sourceFile = project.entrySourceFiles[entry];
						if (!sourceFile) {
							return yield* new TypeScriptProjectError({
								message: `TypeScript did not load ${entry}`,
							});
						}
						const execution = yield* analyzeSandboxExecution(sourceFile);
						return { entry, execution, sourceFile } satisfies SandboxProjectEntry;
					}),
				);
				return {
					entries: projectEntries,
					diagnostics: project.diagnostics,
					sourceFiles: project.sourceFiles,
				};
			}),
	);

export const createTypeScriptSourcesProject = (
	sources: SandboxTypeScriptSources,
	sdkEntries: Readonly<Record<string, string>>,
	tsserverPath: string,
) =>
	createTypeScriptSourcesProjectForEntries(sources, [sources.entry], sdkEntries, tsserverPath).pipe(
		Effect.flatMap(({ diagnostics, sourceFiles, entries: [entry] }) =>
			entry
				? Effect.succeed({ entry, diagnostics, sourceFiles })
				: Effect.die(`TypeScript returned no analysis for ${sources.entry}`),
		),
	);
