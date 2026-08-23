import {
	SANDBOX_RUNTIME_EXTERNAL_SPECIFIERS,
	SANDBOX_SDK_IMPORTS,
} from "@ryot-app/sandbox-sdk/imports";
import { buildDenoEsm } from "@ryot-app/vite-compiler";
import type { CompilerWorkspaceOptions, ViteDiagnostic } from "@ryot-app/vite-compiler";
import { Effect } from "effect";

import {
	type SandboxCompilerDiagnostic,
	SANDBOX_SOURCE_FILE,
	sandboxCompilationFailure,
} from "./compiler-diagnostics";
import type { SandboxTypeScriptSources } from "./compiler-project";

type BundleResult =
	| { readonly success: false; readonly diagnostics: readonly SandboxCompilerDiagnostic[] }
	| { readonly success: true; readonly javascript: string };

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

const bundleSandboxScript = (
	sources: SandboxTypeScriptSources,
	sdkEntries: Readonly<Record<string, string>>,
	workspaceOptions: CompilerWorkspaceOptions = {},
) =>
	buildDenoEsm({
		outputFile,
		workspaceOptions,
		entry: sources.entry,
		approvedExternalSpecifiers: externalDependencyImports,
		sources: Object.entries(sources.files).map(([path, contents]) => ({ path, contents })),
		aliases: bundledSdkImports.map((specifier) => ({
			find: exactAlias(specifier),
			replacement: sdkEntries[specifier] ?? specifier,
		})),
	}).pipe(
		Effect.map(({ javascript, diagnostics }) =>
			diagnostics.some(({ severity }) => severity === "error")
				? ({
						success: false,
						diagnostics: diagnostics.map(toBuildDiagnostic),
					} satisfies BundleResult)
				: ({ javascript, success: true } satisfies BundleResult),
		),
		Effect.catchIf(
			(error) => error.reason === "invalid-output",
			(error) =>
				Effect.succeed({
					success: false,
					diagnostics: error.diagnostics?.length
						? error.diagnostics.map(toBuildDiagnostic)
						: [bundleDiagnostic(error.message)],
				} satisfies BundleResult),
		),
		Effect.mapError((error) =>
			sandboxCompilationFailure(
				error.diagnostics?.length
					? error.diagnostics.map(toBuildDiagnostic)
					: [bundleDiagnostic(`JavaScript bundling failed: ${error.message}`)],
			),
		),
	);

export const bundleUserScript = (
	source: string,
	sdkEntries: Readonly<Record<string, string>>,
	workspaceOptions?: CompilerWorkspaceOptions,
) =>
	bundleSandboxScript(
		{ entry: SANDBOX_SOURCE_FILE, files: { [SANDBOX_SOURCE_FILE]: source } },
		sdkEntries,
		workspaceOptions,
	);

export const bundleBuiltInScript = (
	sources: SandboxTypeScriptSources,
	sdkEntries: Readonly<Record<string, string>>,
	workspaceOptions?: CompilerWorkspaceOptions,
) => bundleSandboxScript(sources, sdkEntries, workspaceOptions);
