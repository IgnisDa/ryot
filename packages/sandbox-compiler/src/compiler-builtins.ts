import type { SandboxManifest } from "@ryot-app/sandbox-sdk/core";
import type { ProviderOperation } from "@ryot-app/sandbox-sdk/provider";
import { Effect } from "effect";
import * as ts from "typescript/unstable/ast";
import { DiagnosticCategory } from "typescript/unstable/async";

import { bundleSandboxPackage } from "./compiler-bundle";
import { resolveSandboxCompilerDependencies } from "./compiler-dependencies";
import {
	sandboxCompilationFailure,
	sandboxCompilerDiagnostic,
	toTypeScriptDiagnostic,
} from "./compiler-diagnostics";
import { extractSandboxManifest } from "./compiler-manifest";
import { sandboxCompilerPlatformLayer } from "./compiler-platform";
import {
	createTypeScriptSourcesProjectForEntries,
	sandboxSourcePath,
	type SandboxTypeScriptSources,
} from "./compiler-project";
import { type CompiledSandboxModule, SANDBOX_COMPILED_FORMAT } from "./compiler-protocol";
import {
	inspectSandboxModuleImports,
	inspectSandboxSource,
	inspectWorkflowDeterminism,
	inspectWorkflowImports,
	sandboxDefinitionMismatch,
} from "./compiler-source";
import { jsonByteLength, SANDBOX_COMPILER_LIMITS, utf8ByteLength } from "./limits";

export type BuiltInSandboxEntry = SandboxTypeScriptSources;

export type CompiledBuiltInSandboxEntry = {
	readonly entry: string;
	readonly source: string;
	readonly compiled: CompiledSandboxModule;
	readonly providerOperation: string | null;
};

export type SandboxEntryDeclaration =
	| {
			readonly kind: Exclude<SandboxManifest["kind"], "provider">;
			readonly providerOperation?: never;
	  }
	| { readonly kind: "provider"; readonly providerOperation: ProviderOperation };

type SandboxPackageProject = Effect.Success<
	ReturnType<typeof createTypeScriptSourcesProjectForEntries>
>;
type SandboxCompilerDependencies = Effect.Success<typeof resolveSandboxCompilerDependencies>;
type InspectedSandboxEntry = {
	readonly entry: string;
	readonly source: string;
	readonly sourceFile: ts.SourceFile;
	readonly inspection: ReturnType<typeof inspectSandboxSource>;
};
type ValidatedSandboxEntry = InspectedSandboxEntry & { readonly manifest: SandboxManifest };

const relativeModulePath = (sourceFile: ts.SourceFile, specifier: string) => {
	const segments = sourceFile.fileName.split("/").slice(0, -1);
	for (const segment of specifier.split("/")) {
		if (segment === "..") {
			segments.pop();
		} else if (segment !== ".") {
			segments.push(segment);
		}
	}
	return segments.join("/");
};

const workflowSourceFiles = (entry: ts.SourceFile, sourceFiles: ReadonlyArray<ts.SourceFile>) => {
	const byName = new Map(sourceFiles.map((file) => [file.fileName, file]));
	const visited = new Set<string>();
	const reachable: ts.SourceFile[] = [];
	const visit = (file: ts.SourceFile) => {
		if (visited.has(file.fileName)) {
			return;
		}
		visited.add(file.fileName);
		reachable.push(file);
		for (const statement of file.statements) {
			if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) {
				continue;
			}
			const moduleSpecifier = statement.moduleSpecifier;
			if (!moduleSpecifier || !ts.isStringLiteralLikeNode(moduleSpecifier)) {
				continue;
			}
			const specifier = moduleSpecifier.text;
			if (!specifier.startsWith(".")) {
				continue;
			}
			const path = relativeModulePath(file, specifier);
			const dependency =
				byName.get(path) ??
				byName.get(`${path}.ts`) ??
				byName.get(path.replace(/\.js$/, ".ts")) ??
				byName.get(`${path}/index.ts`);
			if (dependency) {
				visit(dependency);
			}
		}
	};
	visit(entry);
	return reachable;
};

const compileBuiltInSandboxEntryInternal = (sources: BuiltInSandboxEntry) =>
	sources.files[sources.entry] === undefined
		? sandboxCompilationFailure([
				sandboxCompilerDiagnostic(
					"RYOT_BUILTIN_ENTRY",
					`Built-in sandbox entry does not exist: ${sources.entry}`,
				),
			])
		: compileSandboxPackageEntriesInternal(sources, [sources.entry]).pipe(
				Effect.flatMap(([compiled]) =>
					compiled
						? Effect.succeed(compiled)
						: sandboxCompilationFailure([
								sandboxCompilerDiagnostic(
									"RYOT_BUILTIN_ENTRY",
									`Built-in sandbox entry does not exist: ${sources.entry}`,
								),
							]),
				),
			);

export const compileBuiltInSandboxEntry = (sources: BuiltInSandboxEntry) =>
	compileBuiltInSandboxEntryInternal(sources).pipe(Effect.provide(sandboxCompilerPlatformLayer));

export const compileBuiltInSandboxEntries = (entries: readonly BuiltInSandboxEntry[]) =>
	Effect.forEach(entries, compileBuiltInSandboxEntryInternal, { concurrency: 2 }).pipe(
		Effect.provide(sandboxCompilerPlatformLayer),
	);

const createSandboxPackageProject = (
	sources: SandboxTypeScriptSources,
	entries: ReadonlyArray<string>,
) =>
	Effect.gen(function* () {
		for (const entry of entries) {
			if (sources.files[entry] === undefined) {
				return yield* sandboxCompilationFailure([
					sandboxCompilerDiagnostic("RYOT_SANDBOX_ENTRY", `Sandbox entry does not exist: ${entry}`),
				]);
			}
		}
		for (const [path, contents] of Object.entries(sources.files)) {
			if (utf8ByteLength(contents) > SANDBOX_COMPILER_LIMITS.sourceBytes) {
				return yield* sandboxCompilationFailure([
					{
						...sandboxCompilerDiagnostic(
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
				sandboxCompilationFailure([
					sandboxCompilerDiagnostic(
						"RYOT_COMPILER",
						`TypeScript compiler failed: ${String(error)}`,
					),
				]),
			),
		);
		const typeErrors = project.diagnostics.filter(
			(diagnostic) => diagnostic.category === DiagnosticCategory.Error,
		);
		const firstEntry = entries[0];
		const fallbackSourceFile = firstEntry ? project.entrySourceFiles[firstEntry] : undefined;
		if (!fallbackSourceFile) {
			return yield* sandboxCompilationFailure([
				sandboxCompilerDiagnostic("RYOT_SANDBOX_ENTRY", "Sandbox entries were not loaded"),
			]);
		}
		return { project, typeErrors, dependencies, fallbackSourceFile };
	});

const validateSandboxProjectDiagnostics = (
	project: SandboxPackageProject,
	typeErrors: SandboxPackageProject["diagnostics"],
	fallbackSourceFile: ts.SourceFile,
) =>
	typeErrors.length === 0
		? Effect.void
		: sandboxCompilationFailure(
				typeErrors
					.slice(0, SANDBOX_COMPILER_LIMITS.diagnosticCount)
					.map((diagnostic) =>
						toTypeScriptDiagnostic(diagnostic, project.sourceFiles, fallbackSourceFile),
					),
			);

const inspectSandboxPackageEntries = (
	sources: SandboxTypeScriptSources,
	entries: ReadonlyArray<string>,
	project: SandboxPackageProject,
) =>
	Effect.forEach(entries, (entry) => {
		const source = sources.files[entry];
		const sourceFile = project.entrySourceFiles[entry];
		if (!source || !sourceFile) {
			return sandboxCompilationFailure([
				sandboxCompilerDiagnostic("RYOT_SANDBOX_ENTRY", `Sandbox entry was not loaded: ${entry}`),
			]);
		}
		const inspection = inspectSandboxSource(sourceFile, { allowRelativeImports: true });
		if (inspection.diagnostics.length > 0) {
			return sandboxCompilationFailure(inspection.diagnostics);
		}
		return Effect.succeed({
			entry,
			source,
			sourceFile,
			inspection,
		} satisfies InspectedSandboxEntry);
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
	return Effect.forEach(entries, ({ entry, source, sourceFile, inspection }) =>
		Effect.gen(function* () {
			const moduleDiagnostics = project.sourceFiles
				.filter((file) => file !== sourceFile)
				.flatMap((file) => moduleDiagnosticsBySource.get(file) ?? []);
			if (moduleDiagnostics.length > 0) {
				return yield* sandboxCompilationFailure(moduleDiagnostics);
			}

			const extracted = extractSandboxManifest(sourceFile, inspection.manifestHelpers);
			if (extracted.diagnostic) {
				return yield* sandboxCompilationFailure([extracted.diagnostic]);
			}
			const definitionMismatch = sandboxDefinitionMismatch(inspection, extracted.manifest);
			if (definitionMismatch) {
				return yield* sandboxCompilationFailure([
					sandboxCompilerDiagnostic("RYOT_DEFINITION", definitionMismatch),
				]);
			}
			if (extracted.manifest.kind === "workflow") {
				const diagnostics = workflowSourceFiles(sourceFile, project.sourceFiles).flatMap((file) =>
					inspectWorkflowImports(file).concat(inspectWorkflowDeterminism(file)),
				);
				if (diagnostics.length > 0) {
					return yield* sandboxCompilationFailure(diagnostics);
				}
			}
			const declaration = declarations.get(entry);
			if (declaration && inspection.definitionKind !== declaration.kind) {
				return yield* sandboxCompilationFailure([
					sandboxCompilerDiagnostic(
						"RYOT_DEFINITION",
						`Plugin declaration kind "${declaration.kind}" must use the matching definition helper`,
					),
				]);
			}
			if (
				declaration?.kind === "provider" &&
				inspection.providerOperation !== declaration.providerOperation
			) {
				return yield* sandboxCompilationFailure([
					sandboxCompilerDiagnostic(
						"RYOT_DEFINITION",
						`Provider definition operation "${inspection.providerOperation ?? "none"}" does not match plugin declaration "${declaration.providerOperation}"`,
					),
				]);
			}
			if (
				(jsonByteLength(extracted.manifest) ?? Number.POSITIVE_INFINITY) >
				SANDBOX_COMPILER_LIMITS.manifestBytes
			) {
				return yield* sandboxCompilationFailure([
					sandboxCompilerDiagnostic(
						"RYOT_MANIFEST_SIZE",
						`Sandbox manifest exceeds ${SANDBOX_COMPILER_LIMITS.manifestBytes} UTF-8 bytes`,
					),
				]);
			}

			return { entry, source, sourceFile, inspection, manifest: extracted.manifest };
		}),
	);
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
		const javascriptByEntry = new Map(bundled.map(({ entry, javascript }) => [entry, javascript]));
		return yield* Effect.forEach(entries, ({ entry, source, manifest, inspection }) => {
			const javascript = javascriptByEntry.get(entry);
			if (javascript === undefined) {
				return sandboxCompilationFailure([
					sandboxCompilerDiagnostic("RYOT_BUNDLE", `Compiler returned no output for ${entry}`),
				]);
			}
			if (utf8ByteLength(javascript) > SANDBOX_COMPILER_LIMITS.javascriptBytes) {
				return sandboxCompilationFailure([
					sandboxCompilerDiagnostic(
						"RYOT_COMPILED_SIZE",
						`Compiled sandbox module exceeds ${SANDBOX_COMPILER_LIMITS.javascriptBytes} UTF-8 bytes`,
					),
				]);
			}
			return Effect.succeed({
				entry,
				source,
				providerOperation: inspection.providerOperation,
				compiled: { manifest, javascript, format: SANDBOX_COMPILED_FORMAT },
			} satisfies CompiledBuiltInSandboxEntry);
		});
	});

const compileSandboxPackageEntriesInternal = (
	sources: SandboxTypeScriptSources,
	entries: ReadonlyArray<string>,
	declarations: ReadonlyMap<string, SandboxEntryDeclaration> = new Map(),
) =>
	Effect.gen(function* () {
		if (entries.length === 0) {
			return [];
		}
		const { project, typeErrors, dependencies, fallbackSourceFile } =
			yield* createSandboxPackageProject(sources, entries);
		const inspectedEntries = yield* inspectSandboxPackageEntries(sources, entries, project);
		yield* validateSandboxProjectDiagnostics(project, typeErrors, fallbackSourceFile);
		const validatedEntries = yield* validateSandboxPackageEntries(
			inspectedEntries,
			project,
			declarations,
		);
		return yield* compileValidatedSandboxEntries(sources, validatedEntries, dependencies);
	});

export const compileSandboxPackageEntries = (
	sources: SandboxTypeScriptSources,
	entries: ReadonlyArray<string>,
	declarations: ReadonlyMap<string, SandboxEntryDeclaration> = new Map(),
) =>
	compileSandboxPackageEntriesInternal(sources, entries, declarations).pipe(
		Effect.provide(sandboxCompilerPlatformLayer),
	);
