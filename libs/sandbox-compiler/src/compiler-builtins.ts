import { Effect } from "effect";
import type * as ts from "typescript/unstable/ast";
import { DiagnosticCategory, type Diagnostic } from "typescript/unstable/async";

import { bundleBuiltInScript } from "./compiler-bundle";
import { resolveSandboxCompilerDependencies } from "./compiler-dependencies";
import {
	type SandboxCompilerDiagnostic,
	sandboxCompilationFailure,
	sandboxCompilerDiagnostic,
	sandboxLogicalFile,
} from "./compiler-diagnostics";
import { extractSandboxManifest } from "./compiler-manifest";
import { createTypeScriptSourcesProject, type SandboxTypeScriptSources } from "./compiler-project";
import { type CompiledSandboxModule, SANDBOX_COMPILED_FORMAT } from "./compiler-protocol";
import { inspectSandboxModuleImports, inspectSandboxSource } from "./compiler-source";
import { jsonByteLength, SANDBOX_COMPILER_LIMITS, utf8ByteLength } from "./limits";

export type BuiltInSandboxEntry = SandboxTypeScriptSources;

export type CompiledBuiltInSandboxEntry = {
	readonly entry: string;
	readonly source: string;
	readonly compiled: CompiledSandboxModule;
};

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
	files: readonly ts.SourceFile[],
	entry: ts.SourceFile,
): SandboxCompilerDiagnostic => {
	const file = files.find((sourceFile) => sourceFile.fileName === diagnostic.fileName) ?? entry;
	const start = Math.max(0, diagnostic.pos);
	const location = diagnostic.fileName ? file.getLineAndCharacterOfPosition(start) : undefined;

	return {
		code: `TS${diagnostic.code}`,
		line: (location?.line ?? 0) + 1,
		column: (location?.character ?? 0) + 1,
		message: diagnosticMessage(diagnostic),
		severity: diagnosticSeverity(diagnostic.category),
		file: sandboxLogicalFile(diagnostic.fileName ?? entry.fileName),
		...(diagnostic.end > diagnostic.pos ? { length: diagnostic.end - diagnostic.pos } : {}),
	};
};

export const compileBuiltInSandboxEntry = (sources: BuiltInSandboxEntry) =>
	Effect.gen(function* () {
		const source = sources.files[sources.entry];
		if (source === undefined) {
			return yield* sandboxCompilationFailure([
				sandboxCompilerDiagnostic(
					"RYOT_BUILTIN_ENTRY",
					`Built-in sandbox entry does not exist: ${sources.entry}`,
				),
			]);
		}
		for (const [path, contents] of Object.entries(sources.files)) {
			if (utf8ByteLength(contents) > SANDBOX_COMPILER_LIMITS.sourceBytes) {
				return yield* sandboxCompilationFailure([
					{
						...sandboxCompilerDiagnostic(
							"RYOT_SOURCE_SIZE",
							`Built-in sandbox source exceeds ${SANDBOX_COMPILER_LIMITS.sourceBytes} UTF-8 bytes`,
						),
						file: path,
					},
				]);
			}
		}

		const dependencies = yield* resolveSandboxCompilerDependencies;
		const project = yield* createTypeScriptSourcesProject(
			sources,
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
		const inspection = inspectSandboxSource(project.sourceFile, { allowRelativeImports: true });
		const moduleDiagnostics = project.sourceFiles
			.filter((file) => file !== project.sourceFile)
			.flatMap(inspectSandboxModuleImports);
		const inspectionDiagnostics = [...inspection.diagnostics, ...moduleDiagnostics];
		if (inspectionDiagnostics.length > 0) {
			return yield* sandboxCompilationFailure(inspectionDiagnostics);
		}

		const typeErrors = project.diagnostics.filter(
			(diagnostic) => diagnostic.category === DiagnosticCategory.Error,
		);
		if (typeErrors.length > 0) {
			return yield* sandboxCompilationFailure(
				typeErrors
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
		if (inspection.definitionKind !== extracted.manifest.kind) {
			return yield* sandboxCompilationFailure([
				sandboxCompilerDiagnostic(
					"RYOT_DEFINITION",
					`Manifest kind "${extracted.manifest.kind}" must use ${extracted.manifest.kind === "provider" ? "defineProvider" : "defineScript"}`,
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

		const bundled = yield* bundleBuiltInScript(sources, dependencies.sdkEntries);
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
			source,
			entry: sources.entry,
			compiled: {
				manifest: extracted.manifest,
				javascript: bundled.javascript,
				format: SANDBOX_COMPILED_FORMAT,
			},
		} satisfies CompiledBuiltInSandboxEntry;
	});

export const compileBuiltInSandboxEntries = (entries: readonly BuiltInSandboxEntry[]) =>
	Effect.forEach(entries, compileBuiltInSandboxEntry, { concurrency: 2 });
