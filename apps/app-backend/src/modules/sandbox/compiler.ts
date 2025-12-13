import {
	SandboxCompilationFailure,
	type SandboxCompilationDiagnostic,
} from "@ryot/contract/modules/sandbox/schemas";
import type { SandboxManifest } from "@ryot/sandbox-sdk";
import { Effect } from "effect";
import type * as ts from "typescript/unstable/ast";
import { DiagnosticCategory, type Diagnostic } from "typescript/unstable/async";

import { bundleUserScript } from "./compiler-bundle";
import { extractSandboxManifest } from "./compiler-manifest";
import { createTypeScriptProject } from "./compiler-project";
import { inspectSandboxSource, SANDBOX_SDK_IMPORT, SANDBOX_SOURCE_FILE } from "./compiler-source";

export const SANDBOX_COMPILED_FORMAT = 1 as const;

export type CompiledSandboxModule = {
	readonly javascript: string;
	readonly manifest: SandboxManifest;
	readonly format: typeof SANDBOX_COMPILED_FORMAT;
};

const compilationFailedMessage = "Sandbox TypeScript compilation failed";

const compilationFailure = (diagnostics: readonly SandboxCompilationDiagnostic[]) =>
	new SandboxCompilationFailure({
		message: compilationFailedMessage,
		diagnostics: [...diagnostics],
	});

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
): SandboxCompilationDiagnostic => {
	const start = Math.max(0, diagnostic.pos);
	const location = diagnostic.fileName ? file.getLineAndCharacterOfPosition(start) : undefined;

	return {
		file: SANDBOX_SOURCE_FILE,
		code: `TS${diagnostic.code}`,
		line: (location?.line ?? 0) + 1,
		column: (location?.character ?? 0) + 1,
		severity: diagnosticSeverity(diagnostic.category),
		message: diagnosticMessage(diagnostic),
		...(diagnostic.end > diagnostic.pos ? { length: diagnostic.end - diagnostic.pos } : {}),
	};
};

export class SandboxCompiler extends Effect.Service<SandboxCompiler>()("SandboxCompiler", {
	sync: () => ({
		compile: (source: string) =>
			Effect.gen(function* () {
				const dependencies = yield* Effect.try({
					try: () => {
						const from = Bun.fileURLToPath(new URL(".", import.meta.url));
						const typescriptPackage = Bun.resolveSync("typescript/package.json", from);
						const typescriptDirectory = typescriptPackage.slice(
							0,
							typescriptPackage.lastIndexOf("/"),
						);
						const nativePackage = `@typescript/typescript-${process.platform}-${process.arch}`;
						const nativePackageJson = Bun.resolveSync(
							`${nativePackage}/package.json`,
							typescriptDirectory,
						);
						const nativeDirectory = nativePackageJson.slice(0, nativePackageJson.lastIndexOf("/"));
						return {
							sdkEntry: Bun.resolveSync(SANDBOX_SDK_IMPORT, from),
							tsserverPath: `${nativeDirectory}/lib/tsc${process.platform === "win32" ? ".exe" : ""}`,
						};
					},
					catch: (error) =>
						compilationFailure([
							{
								line: 1,
								column: 1,
								file: SANDBOX_SOURCE_FILE,
								severity: "error",
								code: "RYOT_COMPILER",
								message: `Sandbox compiler dependencies could not be resolved: ${String(error)}`,
							},
						]),
				});
				const project = yield* createTypeScriptProject(
					source,
					dependencies.sdkEntry,
					dependencies.tsserverPath,
				).pipe(
					Effect.mapError((error) =>
						compilationFailure([
							{
								line: 1,
								column: 1,
								file: SANDBOX_SOURCE_FILE,
								severity: "error",
								code: "RYOT_COMPILER",
								message: `TypeScript compiler failed: ${String(error)}`,
							},
						]),
					),
				);
				const inspection = inspectSandboxSource(project.sourceFile);
				if (inspection.diagnostics.length > 0) {
					return yield* compilationFailure(inspection.diagnostics);
				}

				const typeDiagnostics = project.diagnostics.map((diagnostic) =>
					toTypeScriptDiagnostic(diagnostic, project.sourceFile),
				);
				if (typeDiagnostics.some((diagnostic) => diagnostic.severity === "error")) {
					return yield* compilationFailure(typeDiagnostics);
				}

				const extracted = extractSandboxManifest(project.sourceFile, inspection.manifestHelpers);
				if ("diagnostic" in extracted) {
					return yield* compilationFailure([extracted.diagnostic]);
				}

				const bundled = yield* bundleUserScript(source, dependencies.sdkEntry);
				if ("diagnostics" in bundled) {
					return yield* compilationFailure(bundled.diagnostics);
				}

				return {
					manifest: extracted.manifest,
					javascript: bundled.javascript,
					format: SANDBOX_COMPILED_FORMAT,
				} satisfies CompiledSandboxModule;
			}),
	}),
}) {}
