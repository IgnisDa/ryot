import type { CompilerWorkspaceOptions } from "@ryot-app/vite-compiler";
import { Effect } from "effect";
import { DiagnosticCategory } from "typescript/unstable/async";

import { bundleUserScript } from "./compiler-bundle";
import { resolveSandboxCompilerDependencies } from "./compiler-dependencies";
import {
	pluginBackendCompilerDiagnostic,
	PluginBackendCompilerFailure,
	SANDBOX_SOURCE_FILE,
	sandboxCompilationFailure,
	toTypeScriptDiagnostic,
} from "./compiler-diagnostics";
import { finalizeCompiledModule } from "./compiler-metadata";
import { createTypeScriptSourcesProject } from "./compiler-project";
import { inspectSandboxSource } from "./compiler-source";
import { validateSandboxEntry } from "./compiler-validation";
import { SANDBOX_COMPILER_LIMITS, utf8ByteLength } from "./limits";

export const compileSandboxSource = (source: string, workspaceOptions?: CompilerWorkspaceOptions) =>
	Effect.gen(function* () {
		if (utf8ByteLength(source) > SANDBOX_COMPILER_LIMITS.sourceBytes) {
			return yield* sandboxCompilationFailure([
				pluginBackendCompilerDiagnostic(
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
		const inspection = inspectSandboxSource(project.sourceFile);
		const hasTypeErrors = project.diagnostics.some(
			(diagnostic) => diagnostic.category === DiagnosticCategory.Error,
		);
		const validated = yield* validateSandboxEntry({
			execution: project.execution,
			sourceFiles: project.sourceFiles,
			inspected: { source, inspection, entry: SANDBOX_SOURCE_FILE, sourceFile: project.sourceFile },
			validateTypes: hasTypeErrors
				? sandboxCompilationFailure(
						project.diagnostics
							.filter((diagnostic) => diagnostic.category === DiagnosticCategory.Error)
							.slice(0, SANDBOX_COMPILER_LIMITS.diagnosticCount)
							.map((diagnostic) =>
								toTypeScriptDiagnostic(diagnostic, project.sourceFiles, project.sourceFile),
							),
					)
				: Effect.void,
		});

		const compiled = yield* bundleUserScript(source, dependencies.sdkEntries, workspaceOptions);
		return yield* finalizeCompiledModule({
			manifest: validated.manifest,
			metadata: validated.metadata,
			javascript: compiled.javascript,
			runtimeImports: compiled.runtimeImports,
		});
	});
