import { createTypeScriptProject } from "@ryot/typescript-compiler";
import { Data, Effect } from "effect";

const virtualRoot = "/__ryot_sandbox__";

class TypeScriptProjectError extends Data.TaggedError("TypeScriptProjectError")<{
	message: string;
}> {}

export type SandboxTypeScriptSources = {
	readonly entry: string;
	readonly files: Readonly<Record<string, string>>;
};

export const createTypeScriptSourcesProjectForEntries = (
	sources: SandboxTypeScriptSources,
	entries: ReadonlyArray<string>,
	sdkEntries: Readonly<Record<string, string>>,
	tsserverPath: string,
) =>
	createTypeScriptProject({
		entries,
		virtualRoot,
		tsserverPath,
		files: sources.files,
		projectKind: "sandbox",
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
	});

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
