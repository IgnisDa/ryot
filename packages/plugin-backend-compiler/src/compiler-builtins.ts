import { Effect } from "effect";

import { bundleSandboxPackage } from "./compiler-bundle";
import { resolveSandboxCompilerDependencies } from "./compiler-dependencies";
import {
	pluginBackendCompilerDiagnostic,
	PluginBackendCompilerFailure,
	sandboxCompilationFailure,
} from "./compiler-diagnostics";
import { finalizeCompiledModule } from "./compiler-metadata";
import {
	createTypeScriptSourcesProjectForEntries,
	sandboxSourcePath,
	type SandboxTypeScriptSources,
} from "./compiler-project";
import type { CompiledSandboxModule } from "./compiler-protocol";
import { inspectSandboxModuleImports } from "./compiler-source";
import {
	type InspectedSandboxEntry,
	inspectSandboxEntry,
	type SandboxEntryDeclaration,
	type ValidatedSandboxEntry,
	validateSandboxEntry,
	validateSandboxProjectDiagnostics,
} from "./compiler-validation";
import { SANDBOX_COMPILER_LIMITS, utf8ByteLength } from "./limits";

export type BuiltInSandboxEntry = SandboxTypeScriptSources;

export type CompiledBuiltInSandboxEntry = {
	readonly entry: string;
	readonly source: string;
	readonly compiled: CompiledSandboxModule;
	readonly providerOperation: null | string;
};

type SandboxCompilerDependencies = Effect.Success<typeof resolveSandboxCompilerDependencies>;
type SandboxPackageProject = Effect.Success<
	ReturnType<typeof createTypeScriptSourcesProjectForEntries>
>;

export const compileBuiltInSandboxEntry = (sources: BuiltInSandboxEntry) =>
	sources.files[sources.entry] === undefined
		? sandboxCompilationFailure([
				pluginBackendCompilerDiagnostic(
					"RYOT_BUILTIN_ENTRY",
					`Built-in sandbox entry does not exist: ${sources.entry}`,
				),
			])
		: compileSandboxPackageEntries(sources, [sources.entry]).pipe(
				Effect.flatMap(([compiled]) =>
					compiled
						? Effect.succeed(compiled)
						: sandboxCompilationFailure([
								pluginBackendCompilerDiagnostic(
									"RYOT_BUILTIN_ENTRY",
									`Built-in sandbox entry does not exist: ${sources.entry}`,
								),
							]),
				),
			);

const createSandboxPackageProject = (
	sources: SandboxTypeScriptSources,
	entries: ReadonlyArray<string>,
) =>
	Effect.gen(function* () {
		for (const entry of entries) {
			if (sources.files[entry] === undefined) {
				return yield* sandboxCompilationFailure([
					pluginBackendCompilerDiagnostic(
						"RYOT_SANDBOX_ENTRY",
						`Sandbox entry does not exist: ${entry}`,
					),
				]);
			}
		}
		for (const [path, contents] of Object.entries(sources.files)) {
			if (utf8ByteLength(contents) > SANDBOX_COMPILER_LIMITS.sourceBytes) {
				return yield* sandboxCompilationFailure([
					{
						...pluginBackendCompilerDiagnostic(
							"RYOT_SOURCE_SIZE",
							`Sandbox source exceeds ${SANDBOX_COMPILER_LIMITS.sourceBytes} UTF-8 bytes`,
						),
						file: path,
					},
				]);
			}
		}

		const dependencies = yield* resolveSandboxCompilerDependencies;
		const project = yield* createTypeScriptSourcesProjectForEntries(
			sources,
			entries,
			dependencies.sdkEntries,
			dependencies.tsserverPath,
		).pipe(
			Effect.mapError((error) =>
				error instanceof PluginBackendCompilerFailure
					? error
					: sandboxCompilationFailure([
							pluginBackendCompilerDiagnostic(
								"RYOT_COMPILER",
								`TypeScript compiler failed: ${String(error)}`,
							),
						]),
			),
		);
		const fallbackSourceFile = project.entries[0]?.sourceFile;
		if (!fallbackSourceFile) {
			return yield* sandboxCompilationFailure([
				pluginBackendCompilerDiagnostic("RYOT_SANDBOX_ENTRY", "Sandbox entries were not loaded"),
			]);
		}
		return { project, dependencies, fallbackSourceFile };
	});

const inspectSandboxPackageEntries = (
	sources: SandboxTypeScriptSources,
	project: SandboxPackageProject,
) =>
	Effect.forEach(project.entries, (projectEntry) => {
		const source = sources.files[projectEntry.entry];
		if (!source) {
			return sandboxCompilationFailure([
				pluginBackendCompilerDiagnostic(
					"RYOT_SANDBOX_ENTRY",
					`Sandbox entry was not loaded: ${projectEntry.entry}`,
				),
			]);
		}
		return inspectSandboxEntry(projectEntry, source, { allowRelativeImports: true });
	});

const validateSandboxPackageEntries = (
	entries: ReadonlyArray<InspectedSandboxEntry>,
	project: SandboxPackageProject,
	declarations: ReadonlyMap<string, SandboxEntryDeclaration>,
) => {
	const moduleDiagnosticsBySource = new Map(
		project.sourceFiles.map((file) => [
			file,
			inspectSandboxModuleImports(file, sandboxSourcePath(file.fileName)),
		]),
	);
	return Effect.forEach(entries, (inspected) => {
		const declaration = declarations.get(inspected.entry);
		return validateSandboxEntry({
			inspected,
			sourceFiles: project.sourceFiles,
			moduleDiagnostics: project.sourceFiles
				.filter((file) => file !== inspected.sourceFile)
				.flatMap((file) => moduleDiagnosticsBySource.get(file) ?? []),
			...(declaration ? { declaration } : {}),
		});
	});
};

const compileValidatedSandboxEntries = (
	sources: SandboxTypeScriptSources,
	entries: ReadonlyArray<ValidatedSandboxEntry>,
	dependencies: SandboxCompilerDependencies,
) =>
	Effect.gen(function* () {
		const bundled = yield* bundleSandboxPackage(
			sources.files,
			entries.map(({ entry }) => entry),
			dependencies.sdkEntries,
			SANDBOX_COMPILER_LIMITS.concurrency,
		);
		const outputByEntry = new Map(bundled.map((output) => [output.entry, output]));
		return yield* Effect.forEach(entries, ({ entry, source, manifest, metadata, inspection }) => {
			const output = outputByEntry.get(entry);
			if (!output) {
				return sandboxCompilationFailure([
					pluginBackendCompilerDiagnostic(
						"RYOT_BUNDLE",
						`Compiler returned no output for ${entry}`,
					),
				]);
			}
			return finalizeCompiledModule({
				manifest,
				metadata,
				javascript: output.javascript,
				runtimeImports: output.runtimeImports,
			}).pipe(
				Effect.map(
					(compiled) =>
						({
							entry,
							source,
							compiled,
							providerOperation: inspection.providerOperation,
						}) satisfies CompiledBuiltInSandboxEntry,
				),
			);
		});
	});

export const compileSandboxPackageEntries = (
	sources: SandboxTypeScriptSources,
	entries: ReadonlyArray<string>,
	declarations: ReadonlyMap<string, SandboxEntryDeclaration> = new Map(),
) =>
	Effect.gen(function* () {
		if (entries.length === 0) {
			return [];
		}
		const { project, dependencies, fallbackSourceFile } = yield* createSandboxPackageProject(
			sources,
			entries,
		);
		const inspectedEntries = yield* inspectSandboxPackageEntries(sources, project);
		yield* validateSandboxProjectDiagnostics(project, fallbackSourceFile);
		const validatedEntries = yield* validateSandboxPackageEntries(
			inspectedEntries,
			project,
			declarations,
		);
		return yield* compileValidatedSandboxEntries(sources, validatedEntries, dependencies);
	});
