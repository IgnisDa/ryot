import type { ProviderOperation } from "@ryot/sandbox-sdk/provider";
import { Effect } from "effect";
import { DiagnosticCategory } from "typescript/unstable/async";

import { bundleBuiltInScript } from "./compiler-bundle";
import { resolveSandboxCompilerDependencies } from "./compiler-dependencies";
import {
	sandboxCompilationFailure,
	sandboxCompilerDiagnostic,
	toTypeScriptDiagnostic,
} from "./compiler-diagnostics";
import { extractSandboxManifest } from "./compiler-manifest";
import {
	createTypeScriptSourcesProjectForEntries,
	type SandboxTypeScriptSources,
} from "./compiler-project";
import { type CompiledSandboxModule, SANDBOX_COMPILED_FORMAT } from "./compiler-protocol";
import {
	inspectSandboxModuleImports,
	inspectSandboxSource,
	sandboxDefinitionMismatch,
} from "./compiler-source";
import { jsonByteLength, SANDBOX_COMPILER_LIMITS, utf8ByteLength } from "./limits";

export type BuiltInSandboxEntry = SandboxTypeScriptSources;

export type CompiledBuiltInSandboxEntry = {
	readonly entry: string;
	readonly source: string;
	readonly compiled: CompiledSandboxModule;
};

export type SandboxEntryDeclaration =
	| {
			readonly kind: "automation" | "operation" | "script";
			readonly providerOperation?: never;
	  }
	| {
			readonly kind: "provider";
			readonly providerOperation: ProviderOperation;
	  };

export const compileBuiltInSandboxEntry = (sources: BuiltInSandboxEntry) =>
	sources.files[sources.entry] === undefined
		? sandboxCompilationFailure([
				sandboxCompilerDiagnostic(
					"RYOT_BUILTIN_ENTRY",
					`Built-in sandbox entry does not exist: ${sources.entry}`,
				),
			])
		: compileSandboxPackageEntries(sources, [sources.entry]).pipe(
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

export const compileBuiltInSandboxEntries = (entries: readonly BuiltInSandboxEntry[]) =>
	Effect.forEach(entries, compileBuiltInSandboxEntry, { concurrency: 2 });

export const compileSandboxPackageEntries = (
	sources: SandboxTypeScriptSources,
	entries: ReadonlyArray<string>,
	declarations: ReadonlyMap<string, SandboxEntryDeclaration> = new Map(),
) =>
	Effect.gen(function* () {
		if (entries.length === 0) {
			return [];
		}
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
		const inspectedEntries = yield* Effect.forEach(entries, (entry) => {
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
			return Effect.succeed({ entry, source, sourceFile, inspection });
		});
		if (typeErrors.length > 0) {
			return yield* sandboxCompilationFailure(
				typeErrors
					.slice(0, SANDBOX_COMPILER_LIMITS.diagnosticCount)
					.map((diagnostic) =>
						toTypeScriptDiagnostic(diagnostic, project.sourceFiles, fallbackSourceFile),
					),
			);
		}

		return yield* Effect.forEach(inspectedEntries, ({ entry, source, sourceFile, inspection }) => {
			const moduleDiagnostics = project.sourceFiles
				.filter((file) => file !== sourceFile)
				.flatMap(inspectSandboxModuleImports);
			if (moduleDiagnostics.length > 0) {
				return sandboxCompilationFailure(moduleDiagnostics);
			}

			const extracted = extractSandboxManifest(sourceFile, inspection.manifestHelpers);
			if ("diagnostic" in extracted) {
				return sandboxCompilationFailure([extracted.diagnostic]);
			}
			const definitionMismatch = sandboxDefinitionMismatch(inspection, extracted.manifest);
			if (definitionMismatch) {
				return sandboxCompilationFailure([
					sandboxCompilerDiagnostic("RYOT_DEFINITION", definitionMismatch),
				]);
			}
			const declaration = declarations.get(entry);
			if (declaration && inspection.definitionKind !== declaration.kind) {
				return sandboxCompilationFailure([
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
				return sandboxCompilationFailure([
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
				return sandboxCompilationFailure([
					sandboxCompilerDiagnostic(
						"RYOT_MANIFEST_SIZE",
						`Sandbox manifest exceeds ${SANDBOX_COMPILER_LIMITS.manifestBytes} UTF-8 bytes`,
					),
				]);
			}

			return bundleBuiltInScript({ ...sources, entry }, dependencies.sdkEntries).pipe(
				Effect.flatMap((bundled) => {
					if ("diagnostics" in bundled) {
						return sandboxCompilationFailure(bundled.diagnostics);
					}
					if (utf8ByteLength(bundled.javascript) > SANDBOX_COMPILER_LIMITS.javascriptBytes) {
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
						compiled: {
							manifest: extracted.manifest,
							javascript: bundled.javascript,
							format: SANDBOX_COMPILED_FORMAT,
						},
					} satisfies CompiledBuiltInSandboxEntry);
				}),
			);
		});
	});
