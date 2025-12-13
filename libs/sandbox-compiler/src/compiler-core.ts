import { Effect } from "effect";
import type * as ts from "typescript/unstable/ast";
import { DiagnosticCategory, type Diagnostic } from "typescript/unstable/async";

import { bundleUserScript } from "./compiler-bundle";
import { resolveSandboxCompilerDependencies } from "./compiler-dependencies";
import {
	type SandboxCompilerDiagnostic,
	SANDBOX_SOURCE_FILE,
	sandboxCompilationFailure,
	sandboxCompilerDiagnostic,
} from "./compiler-diagnostics";
import { extractSandboxManifest } from "./compiler-manifest";
import { createTypeScriptProject } from "./compiler-project";
import { type CompiledSandboxModule, SANDBOX_COMPILED_FORMAT } from "./compiler-protocol";
import { inspectSandboxSource, sandboxDefinitionMismatch } from "./compiler-source";
import { jsonByteLength, SANDBOX_COMPILER_LIMITS, utf8ByteLength } from "./limits";

const diagnosticSeverity = (category: DiagnosticCategory) => {
	if (category === DiagnosticCategory.Warning) {
		return "warning" as const;
	}
	if (category === DiagnosticCategory.Message || category === DiagnosticCategory.Suggestion) {
		return "info" as const;
	}
	return "error" as const;
};

const diagnosticMessage = (diagnostic: Diagnostic): string =>
	[diagnostic.text, ...(diagnostic.messageChain ?? []).map(diagnosticMessage)].join("\n");

const toTypeScriptDiagnostic = (
	diagnostic: Diagnostic,
	file: ts.SourceFile,
): SandboxCompilerDiagnostic => {
	const start = Math.max(0, diagnostic.pos);
	const location = diagnostic.fileName ? file.getLineAndCharacterOfPosition(start) : undefined;

	return {
		file: SANDBOX_SOURCE_FILE,
		code: `TS${diagnostic.code}`,
		line: (location?.line ?? 0) + 1,
		column: (location?.character ?? 0) + 1,
		message: diagnosticMessage(diagnostic),
		severity: diagnosticSeverity(diagnostic.category),
		...(diagnostic.end > diagnostic.pos ? { length: diagnostic.end - diagnostic.pos } : {}),
	};
};

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
		const project = yield* createTypeScriptProject(
			source,
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
					.map((diagnostic) => toTypeScriptDiagnostic(diagnostic, project.sourceFile)),
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
