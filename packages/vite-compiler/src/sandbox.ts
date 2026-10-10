import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { decodeExecutableText } from "@ryot-app/ts-utils/executable-text";
import type { TypeScriptProjectConfiguration } from "@ryot-app/typescript-compiler";
import {
	inspectJavaScriptReferences,
	literalString,
} from "@ryot-app/typescript-compiler/javascript-references";
import { Effect, FileSystem, Path, Result } from "effect";
import type { InlineConfig } from "vite";

import { viteCompilerError } from "./error";
import type { ViteCompilerError, ViteDiagnostic } from "./error";
import { buildWithVite } from "./vite";
import { acquireCompilerWorkspace, stageSourceFiles, validateRelativePath } from "./workspace";
import type { CompilerWorkspace, CompilerWorkspaceOptions, WorkspaceFile } from "./workspace";

export interface SandboxEsmAlias {
	readonly replacement: string;
	readonly find: string | RegExp;
}

interface SandboxEsmBuildCommonOptions {
	readonly outputFile: string;
	readonly sourceMap?: boolean;
	readonly aliases?: readonly SandboxEsmAlias[];
	readonly workspaceOptions?: CompilerWorkspaceOptions;
	readonly approvedExternalSpecifiers: ReadonlySet<string>;
	readonly approvedDynamicImportExpressions?: ReadonlySet<string>;
}

export interface SandboxEsmStagedBuildOptions extends SandboxEsmBuildCommonOptions {
	readonly entry: string;
	readonly sources: readonly WorkspaceFile[];
}

export interface SandboxEsmExternalBuildOptions extends SandboxEsmBuildCommonOptions {
	readonly entry: string;
	readonly sources?: undefined;
}

export type SandboxEsmBuildOptions = SandboxEsmStagedBuildOptions | SandboxEsmExternalBuildOptions;

export interface SandboxEsmPackageBuildOptions extends SandboxEsmBuildCommonOptions {
	readonly concurrency?: number;
	readonly entries: readonly string[];
	readonly sources: readonly WorkspaceFile[];
}

export interface SandboxEsmBuildResult {
	readonly javascript: string;
	readonly runtimeImports: readonly string[];
	readonly diagnostics: readonly ViteDiagnostic[];
}

export interface SandboxEsmPackageModule extends SandboxEsmBuildResult {
	readonly entry: string;
}

const typeScriptProject = {
	compilerOptions: {
		target: "ES2022",
		module: "ESNext",
		verbatimModuleSyntax: true,
		moduleResolution: "Bundler",
	},
} satisfies TypeScriptProjectConfiguration;

const forbiddenImportPattern = /^(?:node:|bun:|https?:|npm:|jsr:)/;
const forbiddenViteIdentifiers = new Set([
	"__vite_browser_external",
	"__vite__mapDeps",
	"__vitePreload",
]);

const diagnosticError = (message: string) =>
	viteCompilerError("invalid-output", message, undefined, [{ message, severity: "error" }]);

export const auditSandboxEsmOutput = (
	javascript: string,
	approvedExternalSpecifiers: ReadonlySet<string>,
	approvedDynamicImportExpressions: ReadonlySet<string> = new Set(),
): Result.Result<readonly string[], ViteCompilerError> => {
	let forbiddenHelper: string | undefined;
	let references: ReturnType<typeof inspectJavaScriptReferences>;
	try {
		references = inspectJavaScriptReferences(javascript, (node) => {
			if (node.type === "Identifier") {
				const name = typeof node.name === "string" ? node.name : undefined;
				if (name === "Bun" || (name && forbiddenViteIdentifiers.has(name))) {
					forbiddenHelper ??= name;
				}
			} else if (node.type === "CallExpression") {
				const { callee } = node;
				if (
					callee.type === "Identifier" &&
					(callee.name === "require" || callee.name === "__require")
				) {
					forbiddenHelper ??= callee.name;
				} else if (
					callee.type === "MemberExpression" &&
					!callee.computed &&
					callee.object.type === "Identifier" &&
					callee.object.name === "document" &&
					callee.property.type === "Identifier" &&
					callee.property.name === "getElementsByTagName"
				) {
					forbiddenHelper ??= "document.getElementsByTagName";
				}
			} else if (
				node.type === "NewExpression" &&
				node.callee.type === "Identifier" &&
				node.callee.name === "Event" &&
				node.arguments[0] &&
				literalString(node.arguments[0]) === "vite:preloadError"
			) {
				forbiddenHelper ??= "vite:preloadError Event";
			}
		});
	} catch (cause) {
		return Result.fail(diagnosticError(`Sandbox ESM output could not be parsed: ${String(cause)}`));
	}
	if (forbiddenHelper) {
		return Result.fail(
			diagnosticError(`Sandbox ESM output contains a forbidden runtime helper: ${forbiddenHelper}`),
		);
	}
	if (
		references.dynamicExpressions.some(
			(expression) => !approvedDynamicImportExpressions.has(expression),
		)
	) {
		return Result.fail(diagnosticError("Sandbox ESM output contains a non-literal dynamic import"));
	}
	for (const specifier of references.imports) {
		if (forbiddenImportPattern.test(specifier)) {
			return Result.fail(
				diagnosticError(`Sandbox ESM output contains a forbidden runtime import: ${specifier}`),
			);
		}
		if (!approvedExternalSpecifiers.has(specifier)) {
			return Result.fail(
				diagnosticError(`Sandbox ESM output contains an unapproved external import: ${specifier}`),
			);
		}
	}
	return Result.succeed([...new Set(references.imports)].sort());
};

const externalSourcePath = (path: Path.Path, source: string, absolute: string) => {
	const normalized = absolute.split(path.sep).join("/");
	for (const marker of ["/node_modules/", "/packages/"]) {
		const index = normalized.lastIndexOf(marker);
		if (index >= 0) {
			return `ryot:external/${normalized.slice(index + marker.length)}`;
		}
	}
	const identitySource = path.isAbsolute(source) ? normalized : source.split(path.sep).join("/");
	const identity = sha256Hex(identitySource).slice(0, 12);
	return `ryot:external/${identity}/${path.basename(source)}`;
};

const sourceMapPath = (
	path: Path.Path,
	outputPath: string,
	sourcePath: string,
	generatedPath: string,
) => {
	const roots = [
		[sourcePath, ""],
		[generatedPath, "ryot:generated/"],
	] as const;
	return (source: string, sourcemapPath: string) => {
		const absolute = path.resolve(sourcemapPath ? path.dirname(sourcemapPath) : outputPath, source);
		for (const [root, prefix] of roots) {
			const logical = path.relative(root, absolute);
			if (logical !== ".." && !logical.startsWith(`..${path.sep}`) && !path.isAbsolute(logical)) {
				return `${prefix}${logical.split(path.sep).join("/")}`;
			}
		}
		return externalSourcePath(path, source, absolute);
	};
};

const sandboxConfig = (
	entry: string,
	outputFile: string,
	sourceMap: boolean,
	aliases: readonly SandboxEsmAlias[],
	approvedExternalSpecifiers: ReadonlySet<string>,
	transformSourceMap: ReturnType<typeof sourceMapPath>,
): InlineConfig => ({
	define: { "globalThis.Bun": "undefined" },
	resolve: {
		alias: aliases,
		conditions: ["worker", "browser", "import", "module", "default"],
		mainFields: ["browser", "module", "jsnext:main", "jsnext", "main"],
	},
	build: {
		minify: false,
		target: "es2022",
		cssCodeSplit: false,
		modulePreload: false,
		sourcemap: sourceMap ? "inline" : false,
		lib: { entry, formats: ["es"], fileName: () => outputFile },
		rolldownOptions: {
			preserveEntrySignatures: "strict",
			external: (specifier: string) => approvedExternalSpecifiers.has(specifier),
			output: {
				format: "es",
				codeSplitting: false,
				entryFileNames: outputFile,
				sourcemapExcludeSources: true,
				sourcemapPathTransform: transformSourceMap,
			},
		},
	},
});

const buildStagedEntry = Effect.fn("buildSandboxEsmEntry")(function* (
	workspace: CompilerWorkspace,
	entry: string,
	options: SandboxEsmBuildCommonOptions,
) {
	const path = yield* Path.Path;
	const fs = yield* FileSystem.FileSystem;
	const canonical = yield* Effect.all({
		output: fs.realPath(workspace.outputPath),
		source: fs.realPath(workspace.sourcePath),
		generated: fs.realPath(workspace.generatedPath),
	}).pipe(
		Effect.mapError((cause) =>
			diagnosticError(`Could not resolve compiler workspace: ${String(cause)}`),
		),
	);
	const result = yield* buildWithVite({
		workspace,
		typeScriptProject,
		config: sandboxConfig(
			entry,
			options.outputFile,
			options.sourceMap ?? true,
			options.aliases ?? [],
			options.approvedExternalSpecifiers,
			sourceMapPath(path, canonical.output, canonical.source, canonical.generated),
		),
	});
	const output = result.files[0];
	if (result.files.length !== 1 || output?.path !== options.outputFile) {
		return yield* diagnosticError(`Vite did not emit exactly ${options.outputFile}`);
	}
	const decoded = yield* Effect.try({
		try: () => decodeExecutableText(output.bytes),
		catch: () => diagnosticError("Vite emitted JavaScript that is not valid UTF-8"),
	});
	const javascript = decoded
		.replace(
			"sourceMappingURL=data:application/json;charset=utf-8;base64,",
			"sourceMappingURL=data:application/json;base64,",
		)
		.replace(/^\/\/#region .*\/source\/(.+)$/gm, "//#region $1")
		.replace(/^\/\/#region .*\/generated\/(.+)$/gm, "//#region ryot:generated/$1");
	const runtimeImports = yield* Effect.fromResult(
		auditSandboxEsmOutput(
			javascript,
			options.approvedExternalSpecifiers,
			options.approvedDynamicImportExpressions,
		),
	);
	return {
		javascript,
		runtimeImports,
		diagnostics: result.diagnostics,
	} satisfies SandboxEsmBuildResult;
});

export const buildSandboxEsm = Effect.fn("buildSandboxEsm")(function* (
	options: SandboxEsmBuildOptions,
) {
	return yield* Effect.scoped(
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const workspace = yield* acquireCompilerWorkspace(options.workspaceOptions);
			let entry: string;
			if (options.sources !== undefined) {
				const stagedEntry = yield* Effect.fromResult(validateRelativePath(options.entry));
				yield* stageSourceFiles(workspace, options.sources);
				entry = path.resolve(workspace.sourcePath, stagedEntry);
			} else {
				entry = options.entry;
			}
			return yield* buildStagedEntry(workspace, entry, options);
		}),
	);
});

export const buildSandboxEsmPackage = Effect.fn("buildSandboxEsmPackage")(function* (
	options: SandboxEsmPackageBuildOptions,
) {
	return yield* Effect.scoped(
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const workspace = yield* acquireCompilerWorkspace(options.workspaceOptions);
			const stagedEntries = yield* Effect.forEach(options.entries, (entry) =>
				Effect.fromResult(validateRelativePath(entry)),
			);
			yield* stageSourceFiles(workspace, options.sources);
			return yield* Effect.forEach(
				stagedEntries,
				(entry) =>
					buildStagedEntry(workspace, path.resolve(workspace.sourcePath, entry), options).pipe(
						Effect.map(
							(result) => Object.assign({ entry }, result) satisfies SandboxEsmPackageModule,
						),
					),
				{ concurrency: options.concurrency ?? 1 },
			);
		}),
	);
});
