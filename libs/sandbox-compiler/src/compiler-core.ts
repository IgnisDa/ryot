import { Effect } from "effect";
import { DiagnosticCategory } from "typescript/unstable/async";

import { bundleUserScript } from "./compiler-bundle";
import { resolveSandboxCompilerDependencies } from "./compiler-dependencies";
import {
	SANDBOX_SOURCE_FILE,
	sandboxCompilationFailure,
	sandboxCompilerDiagnostic,
	toTypeScriptDiagnostic,
} from "./compiler-diagnostics";
import { extractSandboxManifest } from "./compiler-manifest";
import { createTypeScriptSourcesProject } from "./compiler-project";
import { type CompiledSandboxModule, SANDBOX_COMPILED_FORMAT } from "./compiler-protocol";
import { inspectSandboxSource, sandboxDefinitionMismatch } from "./compiler-source";
import { jsonByteLength, SANDBOX_COMPILER_LIMITS, utf8ByteLength } from "./limits";

export const compileSandboxSource = (source: string) =>
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
				sandboxCompilationFailure([
					sandboxCompilerDiagnostic(
						"RYOT_COMPILER",
						`TypeScript compiler failed: ${String(error)}`,
					),
				]),
			),
		);
		const inspection = inspectSandboxSource(project.sourceFile);
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
		if ("diagnostic" in extracted) {
			return yield* sandboxCompilationFailure([extracted.diagnostic]);
		}
		const definitionMismatch = sandboxDefinitionMismatch(inspection, extracted.manifest);
		if (definitionMismatch) {
			return yield* sandboxCompilationFailure([
				sandboxCompilerDiagnostic("RYOT_DEFINITION", definitionMismatch),
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

		const bundled = yield* bundleUserScript(source, dependencies.sdkEntries);
		if ("diagnostics" in bundled) {
			return yield* sandboxCompilationFailure(bundled.diagnostics);
		}
		if (utf8ByteLength(bundled.javascript) > SANDBOX_COMPILER_LIMITS.javascriptBytes) {
			return yield* sandboxCompilationFailure([
				sandboxCompilerDiagnostic(
					"RYOT_COMPILED_SIZE",
					`Compiled sandbox module exceeds ${SANDBOX_COMPILER_LIMITS.javascriptBytes} UTF-8 bytes`,
				),
			]);
		}

		return {
			manifest: extracted.manifest,
			javascript: bundled.javascript,
			format: SANDBOX_COMPILED_FORMAT,
		} satisfies CompiledSandboxModule;
	});
