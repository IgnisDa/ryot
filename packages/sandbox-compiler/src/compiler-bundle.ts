import { basename, resolve } from "node:path";

import { SANDBOX_RUNTIME_SDK_IMPORTS, SANDBOX_SDK_IMPORTS } from "@ryot-app/sandbox-sdk/imports";
import {
	acquireCompilerWorkspace,
	buildWithVite,
	stageGeneratedFiles,
	stageSourceFiles,
} from "@ryot-app/vite-compiler";
import type {
	CompilerWorkspace,
	CompilerWorkspaceOptions,
	ViteDiagnostic,
} from "@ryot-app/vite-compiler";
import { Effect } from "effect";

import {
	type SandboxCompilerDiagnostic,
	SANDBOX_SOURCE_FILE,
	sandboxCompilationFailure,
} from "./compiler-diagnostics";
import { sandboxTypeScriptProject, type SandboxTypeScriptSources } from "./compiler-project";

type BundleResult =
	| { readonly success: false; readonly diagnostics: readonly SandboxCompilerDiagnostic[] }
	| { readonly success: true; readonly javascript: string };

const outputFile = "sandbox.mjs";
const externalDependencyImports = new Set<string>(SANDBOX_RUNTIME_SDK_IMPORTS);
const bundledSdkImports = SANDBOX_SDK_IMPORTS.filter(
	(specifier) => !externalDependencyImports.has(specifier),
);
const importPattern = /^\s*(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gm;
const dynamicImportPattern = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
const forbiddenRuntimePattern =
	/\bBun\b|\b(?:require|__require)\s*\(|__vite(?:_|-)?browser(?:_|-)?external|vite:preloadError|document\.getElementsByTagName/;

const toBuildDiagnostic = (diagnostic: ViteDiagnostic): SandboxCompilerDiagnostic => ({
	message: diagnostic.message,
	severity: diagnostic.severity,
	code: diagnostic.code ?? "RYOT_BUNDLE",
	line: Math.max(1, diagnostic.location?.line ?? 1),
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

const denoViteConfig = (
	workspace: CompilerWorkspace,
	entrypoint: string,
	sdkEntries: Readonly<Record<string, string>>,
) => ({
	resolve: {
		mainFields: ["browser", "module", "jsnext:main", "jsnext", "main"],
		conditions: ["deno", "worker", "browser", "import", "module", "default"],
		alias: bundledSdkImports.map((specifier) => ({
			find: exactAlias(specifier),
			replacement: sdkEntries[specifier] ?? specifier,
		})),
	},
	build: {
		minify: false,
		target: "es2022",
		cssCodeSplit: false,
		modulePreload: false,
		sourcemap: "inline" as const,
		lib: { entry: entrypoint, formats: ["es" as const], fileName: () => outputFile },
		rolldownOptions: {
			preserveEntrySignatures: "strict" as const,
			external: (specifier: string) => externalDependencyImports.has(specifier),
			output: {
				codeSplitting: false,
				format: "es" as const,
				entryFileNames: outputFile,
				sourcemapPathTransform: (source: string) => {
					const absolute = resolve(workspace.outputPath, source);
					if (absolute.startsWith(`${workspace.sourcePath}/`)) {
						return absolute.slice(workspace.sourcePath.length + 1);
					}
					if (absolute.startsWith(`${workspace.generatedPath}/`)) {
						return `ryot:generated/${absolute.slice(workspace.generatedPath.length + 1)}`;
					}
					return `ryot:sdk/${basename(source)}`;
				},
			},
		},
	},
});

const auditDenoEsmOutput = (javascript: string) => {
	const executable = (javascript.split("//# sourceMappingURL", 1)[0] ?? javascript)
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");
	const forbidden = forbiddenRuntimePattern.exec(executable);
	if (forbidden) {
		return bundleDiagnostic(
			`Compiled JavaScript contains a forbidden CommonJS, Bun, or browser helper: ${forbidden[0]}`,
		);
	}
	for (const pattern of [importPattern, dynamicImportPattern]) {
		pattern.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(executable)) !== null) {
			const specifier = match[1];
			if (!specifier) {
				continue;
			}
			if (/^(?:node:|bun:|https?:|npm:|jsr:)/.test(specifier)) {
				return bundleDiagnostic(
					`Compiled JavaScript contains a forbidden runtime import: ${specifier}`,
				);
			}
			if (!externalDependencyImports.has(specifier)) {
				return bundleDiagnostic(
					`Compiled JavaScript contains an unknown external import: ${specifier}`,
				);
			}
		}
	}
	return null;
};

const bundleSandboxScript = (
	sources: SandboxTypeScriptSources,
	sdkEntries: Readonly<Record<string, string>>,
	workspaceOptions: CompilerWorkspaceOptions = {},
) =>
	Effect.scoped(
		Effect.gen(function* () {
			const workspace = yield* acquireCompilerWorkspace(workspaceOptions);
			yield* stageSourceFiles(
				workspace,
				Object.entries(sources.files).map(([path, contents]) => ({ path, contents })),
			);
			yield* stageGeneratedFiles(workspace, [
				{
					path: "entry.ts",
					contents: `export * from ${JSON.stringify(`../source/${sources.entry}`)};\nexport { default } from ${JSON.stringify(`../source/${sources.entry}`)};\n`,
				},
			]);
			const result = yield* buildWithVite({
				workspace,
				typeScriptProject: sandboxTypeScriptProject,
				config: denoViteConfig(workspace, `${workspace.generatedPath}/entry.ts`, sdkEntries),
			});
			if (result.diagnostics.some(({ severity }) => severity === "error")) {
				return {
					success: false,
					diagnostics: result.diagnostics.map(toBuildDiagnostic),
				} satisfies BundleResult;
			}
			const output = result.files[0];
			if (result.files.length !== 1 || output?.path !== outputFile) {
				return {
					success: false,
					diagnostics: [bundleDiagnostic("Compiler did not emit exactly one JavaScript module")],
				} satisfies BundleResult;
			}
			const javascript = new TextDecoder()
				.decode(output.bytes)
				.replace(
					"sourceMappingURL=data:application/json;charset=utf-8;base64,",
					"sourceMappingURL=data:application/json;base64,",
				)
				.replace(/^\/\/#region .*\/source\/(.+)$/gm, "//#region $1")
				.replace(/^\/\/#region .*\/generated\/(.+)$/gm, "//#region ryot:generated/$1");
			const auditDiagnostic = auditDenoEsmOutput(javascript);
			return auditDiagnostic
				? ({ success: false, diagnostics: [auditDiagnostic] } satisfies BundleResult)
				: ({ javascript, success: true } satisfies BundleResult);
		}),
	).pipe(
		Effect.mapError((error) =>
			sandboxCompilationFailure([bundleDiagnostic(`JavaScript bundling failed: ${error.message}`)]),
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
