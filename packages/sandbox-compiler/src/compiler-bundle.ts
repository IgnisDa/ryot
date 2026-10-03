import {
	SANDBOX_RUNTIME_EXTERNAL_SPECIFIERS,
	SANDBOX_SDK_IMPORTS,
} from "@ryot-app/sandbox-sdk/imports";
import { buildDenoEsm, buildDenoEsmPackage } from "@ryot-app/vite-compiler";
import type {
	CompilerWorkspaceOptions,
	DenoEsmBuildResult,
	ViteCompilerError,
	ViteDiagnostic,
} from "@ryot-app/vite-compiler";
import { Effect } from "effect";

import {
	type SandboxCompilerDiagnostic,
	type SandboxCompilerFailure,
	SANDBOX_SOURCE_FILE,
	sandboxCompilationFailure,
} from "./compiler-diagnostics";
import type { SandboxTypeScriptSources } from "./compiler-project";

const outputFile = "sandbox.mjs";
const externalDependencyImports = new Set<string>(SANDBOX_RUNTIME_EXTERNAL_SPECIFIERS);
const bundledSdkImports = SANDBOX_SDK_IMPORTS.filter(
	(specifier) => !externalDependencyImports.has(specifier),
);

const sandboxDiagnosticMessage = (message: string) =>
	message
		.replace(
			"Deno ESM output contains a forbidden runtime helper:",
			"Compiled JavaScript contains a forbidden CommonJS, Bun, or browser helper:",
		)
		.replace(
			"Deno ESM output contains a forbidden runtime import:",
			"Compiled JavaScript contains a forbidden runtime import:",
		)
		.replace(
			"Deno ESM output contains an unapproved external import:",
			"Compiled JavaScript contains an unknown external import:",
		);

const toBuildDiagnostic = (diagnostic: ViteDiagnostic): SandboxCompilerDiagnostic => ({
	severity: diagnostic.severity,
	code: diagnostic.code ?? "RYOT_BUNDLE",
	line: Math.max(1, diagnostic.location?.line ?? 1),
	message: sandboxDiagnosticMessage(diagnostic.message),
	column: Math.max(1, diagnostic.location?.column ?? 1),
	file: (diagnostic.file ?? SANDBOX_SOURCE_FILE).replace(/^source\//, ""),
});

const bundleDiagnostic = (message: string, file = SANDBOX_SOURCE_FILE) => ({
	file,
	line: 1,
	message,
	column: 1,
	code: "RYOT_BUNDLE",
	severity: "error" as const,
});

const exactAlias = (specifier: string) =>
	new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

const sdkAliases = (sdkEntries: Readonly<Record<string, string>>) =>
	bundledSdkImports.map((specifier) => ({
		find: exactAlias(specifier),
		replacement: sdkEntries[specifier] ?? specifier,
	}));

const workspaceFiles = (files: SandboxTypeScriptSources["files"]) =>
	Object.entries(files).map(([path, contents]) => ({ path, contents }));

const bundleFailure = (error: ViteCompilerError) =>
	sandboxCompilationFailure(
		error.diagnostics?.length
			? error.diagnostics.map(toBuildDiagnostic)
			: [
					bundleDiagnostic(
						error.reason === "invalid-output"
							? error.message
							: `JavaScript bundling failed: ${error.message}`,
					),
				],
	);

const compiledJavaScript = (
	build: DenoEsmBuildResult,
): Effect.Effect<string, SandboxCompilerFailure> =>
	build.diagnostics.some(({ severity }) => severity === "error")
		? sandboxCompilationFailure(build.diagnostics.map(toBuildDiagnostic))
		: Effect.succeed(build.javascript);

export const bundleUserScript = (
	source: string,
	sdkEntries: Readonly<Record<string, string>>,
	workspaceOptions: CompilerWorkspaceOptions = {},
) =>
	buildDenoEsm({
		outputFile,
		workspaceOptions,
		entry: SANDBOX_SOURCE_FILE,
		aliases: sdkAliases(sdkEntries),
		approvedExternalSpecifiers: externalDependencyImports,
		sources: workspaceFiles({ [SANDBOX_SOURCE_FILE]: source }),
	}).pipe(Effect.mapError(bundleFailure), Effect.flatMap(compiledJavaScript));

export const bundleSandboxPackage = (
	files: SandboxTypeScriptSources["files"],
	entries: ReadonlyArray<string>,
	sdkEntries: Readonly<Record<string, string>>,
	concurrency: number,
	workspaceOptions: CompilerWorkspaceOptions = {},
) =>
	buildDenoEsmPackage({
		entries,
		outputFile,
		concurrency,
		workspaceOptions,
		sources: workspaceFiles(files),
		aliases: sdkAliases(sdkEntries),
		approvedExternalSpecifiers: externalDependencyImports,
	}).pipe(
		Effect.mapError(bundleFailure),
		Effect.flatMap((modules) =>
			Effect.forEach(modules, (module) =>
				compiledJavaScript(module).pipe(
					Effect.map((javascript) => ({ javascript, entry: module.entry })),
				),
			),
		),
	);
