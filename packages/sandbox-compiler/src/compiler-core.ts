import type { CompilerWorkspaceOptions } from "@ryot-app/vite-compiler";
import { Effect, Result } from "effect";
import { DiagnosticCategory } from "typescript/unstable/async";

import { bundleUserScript } from "./compiler-bundle";
import { resolveSandboxCompilerDependencies } from "./compiler-dependencies";
import {
	SANDBOX_SOURCE_FILE,
	sandboxCompilationFailure,
	SandboxCompilerFailure,
	sandboxCompilerDiagnostic,
	toTypeScriptDiagnostic,
} from "./compiler-diagnostics";
import { extractSandboxManifest } from "./compiler-manifest";
import { finalizeCompiledManifest, validateSandboxCapabilities } from "./compiler-metadata";
import { createTypeScriptSourcesProject } from "./compiler-project";
import { type CompiledSandboxModule, SANDBOX_COMPILED_FORMAT } from "./compiler-protocol";
import { inspectSandboxSource, sandboxDefinitionMismatch } from "./compiler-source";
import { SANDBOX_COMPILER_LIMITS, utf8ByteLength } from "./limits";

export const compileSandboxSource = (source: string, workspaceOptions?: CompilerWorkspaceOptions) =>
	Effect.gen(function* () {
		if (utf8ByteLength(source) > SANDBOX_COMPILER_LIMITS.sourceBytes) {
			return yield* sandboxCompilationFailure([
				sandboxCompilerDiagnostic(
					"RYOT_SOURCE_SIZE",
					`Sandbox TypeScript source exceeds ${SANDBOX_COMPILER_LIMITS.sourceBytes} UTF-8 bytes`,
				),
			]);
		}

		const dependencies = yield* resolveSandboxCompilerDependencies;
		const project = yield* createTypeScriptSourcesProject(
			{ entry: SANDBOX_SOURCE_FILE, files: { [SANDBOX_SOURCE_FILE]: source } },
			dependencies.sdkEntries,
			dependencies.tsserverPath,
		).pipe(
			Effect.mapError((error) =>
				error instanceof SandboxCompilerFailure
					? error
					: sandboxCompilationFailure([
							sandboxCompilerDiagnostic(
								"RYOT_COMPILER",
								`TypeScript compiler failed: ${String(error)}`,
							),
						]),
			),
		);
		const inspection = inspectSandboxSource(project.sourceFile);
		if (!project.execution) {
			return yield* sandboxCompilationFailure([
				sandboxCompilerDiagnostic("RYOT_DEPENDENCY", "Executable analysis is missing"),
			]);
		}
		if (project.execution.diagnostics.length) {
			return yield* sandboxCompilationFailure(project.execution.diagnostics);
		}
		if (inspection.diagnostics.length > 0) {
			return yield* sandboxCompilationFailure(inspection.diagnostics);
		}

		const hasTypeErrors = project.diagnostics.some(
			(diagnostic) => diagnostic.category === DiagnosticCategory.Error,
		);
		if (hasTypeErrors) {
			return yield* sandboxCompilationFailure(
				project.diagnostics
					.filter((diagnostic) => diagnostic.category === DiagnosticCategory.Error)
					.slice(0, SANDBOX_COMPILER_LIMITS.diagnosticCount)
					.map((diagnostic) =>
						toTypeScriptDiagnostic(diagnostic, project.sourceFiles, project.sourceFile),
					),
			);
		}

		const extracted = extractSandboxManifest(project.sourceFile, inspection.manifestHelpers);
		if (extracted.diagnostic) {
			return yield* sandboxCompilationFailure([extracted.diagnostic]);
		}
		const definitionMismatch = sandboxDefinitionMismatch(inspection, extracted.manifest);
		if (definitionMismatch) {
			return yield* sandboxCompilationFailure([
				sandboxCompilerDiagnostic("RYOT_DEFINITION", definitionMismatch),
			]);
		}
		const capabilityDiagnostic = validateSandboxCapabilities({
			...extracted.manifest,
			...project.execution.metadata,
		});
		if (capabilityDiagnostic) {
			return yield* sandboxCompilationFailure([capabilityDiagnostic]);
		}

		const compiled = yield* bundleUserScript(source, dependencies.sdkEntries, workspaceOptions);
		if (utf8ByteLength(compiled.javascript) > SANDBOX_COMPILER_LIMITS.javascriptBytes) {
			return yield* sandboxCompilationFailure([
				sandboxCompilerDiagnostic(
					"RYOT_COMPILED_SIZE",
					`Compiled sandbox module exceeds ${SANDBOX_COMPILER_LIMITS.javascriptBytes} UTF-8 bytes`,
				),
			]);
		}
		const finalManifest = finalizeCompiledManifest(extracted.manifest, {
			...project.execution.metadata,
			runtimeImports: compiled.runtimeImports,
		});
		if (Result.isFailure(finalManifest)) {
			return yield* sandboxCompilationFailure([finalManifest.failure]);
		}

		return {
			manifest: finalManifest.success,
			javascript: compiled.javascript,
			format: SANDBOX_COMPILED_FORMAT,
		} satisfies CompiledSandboxModule;
	});
