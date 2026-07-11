import { SANDBOX_RUNTIME_SDK_IMPORTS, SANDBOX_SDK_IMPORTS } from "@ryot-app/sandbox-sdk/imports";
import { Effect } from "effect";

import {
	type SandboxCompilerDiagnostic,
	type SandboxCompilerFailure,
	SANDBOX_SOURCE_FILE,
	sandboxCompilationFailure,
} from "./compiler-diagnostics";
import type { SandboxTypeScriptSources } from "./compiler-project";

type BundleResult =
	| { readonly diagnostics: readonly SandboxCompilerDiagnostic[] }
	| { readonly javascript: string };

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const externalDependencyImports = [...SANDBOX_RUNTIME_SDK_IMPORTS, "effect"] as const;
const dependencyImportPattern = new RegExp(
	`^(?:${externalDependencyImports.map(escapeRegExp).join("|")})$`,
);
const runtimeSdkImports = new Set<string>(SANDBOX_RUNTIME_SDK_IMPORTS);
const bundledSdkImports = new Set<string>(
	SANDBOX_SDK_IMPORTS.filter((specifier) => !runtimeSdkImports.has(specifier)),
);
const bundledSdkImportPattern = new RegExp(
	`^(?:${[...bundledSdkImports].map(escapeRegExp).join("|")})$`,
);

const buildDiagnosticSeverity = (level: BuildMessage["level"]) => {
	if (level === "warning") {
		return "warning" as const;
	}
	if (level === "info") {
		return "info" as const;
	}
	return "error" as const;
};

const toBuildDiagnostic = (log: BuildMessage | ResolveMessage): SandboxCompilerDiagnostic => ({
	code: "RYOT_BUNDLE",
	message: log.message,
	line: Math.max(1, log.position?.line ?? 1),
	severity: buildDiagnosticSeverity(log.level),
	column: Math.max(1, log.position?.column ?? 1),
	file: log.position?.file ?? SANDBOX_SOURCE_FILE,
	...(log.position === null ? {} : { length: log.position.length }),
});

const bundleSandboxScript = (plugin: Bun.BunPlugin, entrypoint: string) =>
	Effect.tryPromise({
		catch: (error) =>
			sandboxCompilationFailure([
				{
					line: 1,
					column: 1,
					severity: "error",
					code: "RYOT_BUNDLE",
					file: SANDBOX_SOURCE_FILE,
					message: `JavaScript bundling failed: ${String(error)}`,
				},
			]),
		try: () =>
			Bun.build({
				throw: false,
				format: "esm",
				minify: false,
				splitting: false,
				plugins: [plugin],
				target: "browser",
				packages: "bundle",
				sourcemap: "inline",
				allowUnresolved: [],
				entrypoints: [entrypoint],
			}),
	}).pipe(
		Effect.flatMap((result): Effect.Effect<BundleResult, SandboxCompilerFailure> => {
			if (!result.success) {
				return Effect.succeed({ diagnostics: result.logs.map(toBuildDiagnostic) });
			}

			const outputs = result.outputs.filter((output) => output.kind === "entry-point");
			const output = outputs[0];
			if (outputs.length !== 1 || !output) {
				return Effect.succeed({
					diagnostics: [
						{
							line: 1,
							column: 1,
							code: "RYOT_BUNDLE",
							file: SANDBOX_SOURCE_FILE,
							severity: "error" as const,
							message: "Compiler did not emit exactly one JavaScript module",
						},
					],
				});
			}

			return Effect.tryPromise({
				try: () => output.text(),
				catch: (error) =>
					sandboxCompilationFailure([
						{
							line: 1,
							column: 1,
							severity: "error",
							code: "RYOT_BUNDLE",
							file: SANDBOX_SOURCE_FILE,
							message: `Compiled JavaScript could not be read: ${String(error)}`,
						},
					]),
			}).pipe(Effect.map((javascript) => ({ javascript })));
		}),
	);

export const bundleUserScript = (source: string, sdkEntries: Readonly<Record<string, string>>) => {
	const plugin: Bun.BunPlugin = {
		name: "sandbox-user-source",
		setup(builder) {
			builder.onResolve({ filter: /^sandbox:user-source$/ }, () => ({
				path: SANDBOX_SOURCE_FILE,
				namespace: "sandbox-user",
			}));
			builder.onLoad({ filter: /.*/, namespace: "sandbox-user" }, () => ({
				loader: "ts",
				contents: source,
			}));
			builder.onResolve({ filter: bundledSdkImportPattern }, ({ path }) => ({
				namespace: "file",
				path: sdkEntries[path] ?? path,
			}));
			builder.onResolve({ filter: dependencyImportPattern }, ({ path }) => ({
				path,
				external: true,
			}));
		},
	};
	return bundleSandboxScript(plugin, "sandbox:user-source");
};

const normalizeRelativePath = (importer: string, specifier: string) => {
	const parts = [...importer.split("/").slice(0, -1), ...specifier.split("/")];
	const normalized: string[] = [];
	for (const part of parts) {
		if (!part || part === ".") {
			continue;
		}
		if (part === "..") {
			if (normalized.length === 0) {
				return null;
			}
			normalized.pop();
			continue;
		}
		normalized.push(part);
	}
	return normalized.join("/");
};

const resolveBuiltInImport = (
	files: Readonly<Record<string, string>>,
	importer: string,
	specifier: string,
) => {
	const path = normalizeRelativePath(importer, specifier);
	if (!path) {
		return null;
	}
	const candidates = [
		path,
		`${path}.ts`,
		`${path}/index.ts`,
		...(path.endsWith(".js") ? [`${path.slice(0, -3)}.ts`] : []),
	];
	return candidates.find((candidate) => Object.hasOwn(files, candidate)) ?? null;
};

export const bundleBuiltInScript = (
	sources: SandboxTypeScriptSources,
	sdkEntries: Readonly<Record<string, string>>,
) => {
	const plugin: Bun.BunPlugin = {
		name: "sandbox-built-in-source",
		setup(builder) {
			builder.onResolve({ filter: /^sandbox:built-in-entry$/ }, () => ({
				path: sources.entry,
				namespace: "sandbox-built-in",
			}));
			builder.onResolve({ filter: dependencyImportPattern }, ({ path }) => ({
				path,
				external: true,
			}));
			builder.onResolve({ filter: bundledSdkImportPattern }, ({ path }) => ({
				namespace: "file",
				path: sdkEntries[path] ?? path,
			}));
			builder.onResolve({ filter: /^\.{1,2}\// }, (args) => {
				return Object.hasOwn(sources.files, args.importer)
					? {
							namespace: "sandbox-built-in",
							path: resolveBuiltInImport(sources.files, args.importer, args.path) ?? args.path,
						}
					: undefined;
			});
			builder.onResolve({ filter: /^[^.]/, namespace: "sandbox-built-in" }, ({ path }) => ({
				path,
				namespace: "sandbox-built-in",
			}));
			builder.onLoad({ filter: /.*/, namespace: "sandbox-built-in" }, ({ path }) => {
				const source = sources.files[path];
				const resolveDirectory = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";
				return source === undefined
					? Promise.reject(new Error(`Built-in sandbox import could not be resolved: ${path}`))
					: Promise.resolve({
							contents: source,
							loader: "ts" as const,
							resolveDir: resolveDirectory,
						});
			});
		},
	};
	return bundleSandboxScript(plugin, "sandbox:built-in-entry");
};
