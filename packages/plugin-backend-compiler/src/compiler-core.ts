import type { CompilerWorkspaceOptions } from "@ryot-app/vite-compiler";
import { Effect } from "effect";

import { bundleUserScript } from "./compiler-bundle";
import { resolveSandboxCompilerDependencies } from "./compiler-dependencies";
import {
	pluginBackendCompilerDiagnostic,
	PluginBackendCompilerFailure,
	SANDBOX_SOURCE_FILE,
	sandboxCompilationFailure,
} from "./compiler-diagnostics";
import { finalizeCompiledModule } from "./compiler-metadata";
import { createTypeScriptSourcesProject } from "./compiler-project";
import {
	inspectSandboxEntry,
	validateSandboxEntry,
	validateSandboxProjectDiagnostics,
} from "./compiler-validation";
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
		const inspected = yield* inspectSandboxEntry(project.entry, source, {
			allowRelativeImports: false,
		});
		yield* validateSandboxProjectDiagnostics(project, project.entry.sourceFile);
		const validated = yield* validateSandboxEntry({
			inspected,
			moduleDiagnostics: [],
			sourceFiles: project.sourceFiles,
		});

		const compiled = yield* bundleUserScript(source, dependencies.sdkEntries, workspaceOptions);
		return yield* finalizeCompiledModule({
			manifest: validated.manifest,
			metadata: validated.metadata,
			javascript: compiled.javascript,
			runtimeImports: compiled.runtimeImports,
		});
	});
