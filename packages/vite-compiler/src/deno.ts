import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

import type { Node } from "@oxc-project/types";
import type { TypeScriptProjectConfiguration } from "@ryot-app/typescript-compiler";
import { Effect, Result } from "effect";
import { parseAst } from "rolldown/parseAst";
import type { InlineConfig } from "vite";

import { viteCompilerError } from "./error";
import type { ViteCompilerError, ViteDiagnostic } from "./error";
import { buildWithVite } from "./vite";
import { acquireCompilerWorkspace, stageSourceFiles, validateRelativePath } from "./workspace";
import type { CompilerWorkspaceOptions, WorkspaceFile } from "./workspace";

export interface DenoEsmAlias {
	readonly find: string | RegExp;
	readonly replacement: string;
}

interface DenoEsmBuildCommonOptions {
	readonly aliases?: readonly DenoEsmAlias[];
	readonly approvedDynamicImportExpressions?: ReadonlySet<string>;
	readonly approvedExternalSpecifiers: ReadonlySet<string>;
	readonly outputFile: string;
	readonly workspaceOptions?: CompilerWorkspaceOptions;
}

export interface DenoEsmStagedBuildOptions extends DenoEsmBuildCommonOptions {
	readonly entry: string;
	readonly sources: readonly WorkspaceFile[];
}

export interface DenoEsmExternalBuildOptions extends DenoEsmBuildCommonOptions {
	readonly entry: string;
	readonly sources?: undefined;
}

export type DenoEsmBuildOptions = DenoEsmStagedBuildOptions | DenoEsmExternalBuildOptions;

export interface DenoEsmBuildResult {
	readonly javascript: string;
	readonly diagnostics: readonly ViteDiagnostic[];
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

const isAstNode = (value: unknown): value is Node =>
	typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";

const literalString = (node: Node): string | undefined => {
	if (node.type === "Literal" && typeof node.value === "string") {
		return node.value;
	}
	if (node.type !== "TemplateLiteral" || node.expressions.length > 0) {
		return undefined;
	}
	return node.quasis[0]?.value.cooked ?? undefined;
};

export const auditDenoEsmOutput = (
	javascript: string,
	approvedExternalSpecifiers: ReadonlySet<string>,
	approvedDynamicImportExpressions: ReadonlySet<string> = new Set(),
): Result.Result<void, ViteCompilerError> => {
	let program: ReturnType<typeof parseAst>;
	try {
		program = parseAst(javascript, { lang: "js" }, "deno-output.mjs");
	} catch (cause) {
		return Result.fail(diagnosticError(`Deno ESM output could not be parsed: ${String(cause)}`));
	}

	let forbiddenHelper: string | undefined;
	const dynamicImportAudit = { hasUnapproved: false };
	const imports: string[] = [];
	const visit = (value: unknown): void => {
		if (Array.isArray(value)) {
			for (const item of value) {
				visit(item);
			}
			return;
		}
		if (!isAstNode(value)) {
			return;
		}
		const node = value;
		if (node.type === "ImportDeclaration" || node.type === "ExportAllDeclaration") {
			imports.push(node.source.value);
		} else if (node.type === "ExportNamedDeclaration" && node.source !== null) {
			imports.push(node.source.value);
		} else if (node.type === "ImportExpression") {
			const specifier = literalString(node.source);
			if (specifier !== undefined) {
				imports.push(specifier);
			} else if (
				!approvedDynamicImportExpressions.has(javascript.slice(node.source.start, node.source.end))
			) {
				dynamicImportAudit.hasUnapproved = true;
			}
		} else if (node.type === "Identifier") {
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
		for (const [key, child] of Object.entries(node)) {
			if (key !== "parent") {
				visit(child);
			}
		}
	};
	visit(program);
	if (forbiddenHelper) {
		return Result.fail(
			diagnosticError(`Deno ESM output contains a forbidden runtime helper: ${forbiddenHelper}`),
		);
	}
	if (dynamicImportAudit.hasUnapproved) {
		return Result.fail(diagnosticError("Deno ESM output contains a non-literal dynamic import"));
	}
	for (const specifier of imports) {
		if (forbiddenImportPattern.test(specifier)) {
			return Result.fail(
				diagnosticError(`Deno ESM output contains a forbidden runtime import: ${specifier}`),
			);
		}
		if (!approvedExternalSpecifiers.has(specifier)) {
			return Result.fail(
				diagnosticError(`Deno ESM output contains an unapproved external import: ${specifier}`),
			);
		}
	}
	return Result.succeed(undefined);
};

const externalSourcePath = (source: string, absolute: string) => {
	const normalized = absolute.split(sep).join("/");
	for (const marker of ["/node_modules/", "/packages/"]) {
		const index = normalized.lastIndexOf(marker);
		if (index >= 0) {
			return `ryot:external/${normalized.slice(index + marker.length)}`;
		}
	}
	const identitySource = isAbsolute(source) ? normalized : source.split(sep).join("/");
	const identity = createHash("sha256").update(identitySource).digest("hex").slice(0, 12);
	return `ryot:external/${identity}/${basename(source)}`;
};

const sourceMapPath = (outputPath: string, sourcePath: string, generatedPath: string) => {
	const canonicalOutputPath = realpathSync(outputPath);
	const roots = [
		[realpathSync(sourcePath), ""],
		[realpathSync(generatedPath), "ryot:generated/"],
	] as const;
	return (source: string, sourcemapPath: string) => {
		const absolute = resolve(sourcemapPath ? dirname(sourcemapPath) : canonicalOutputPath, source);
		for (const [root, prefix] of roots) {
			const logical = relative(root, absolute);
			if (logical !== ".." && !logical.startsWith(`..${sep}`) && !isAbsolute(logical)) {
				return `${prefix}${logical.split(sep).join("/")}`;
			}
		}
		return externalSourcePath(source, absolute);
	};
};

const denoConfig = (
	entry: string,
	outputFile: string,
	aliases: readonly DenoEsmAlias[],
	approvedExternalSpecifiers: ReadonlySet<string>,
	workspace: {
		readonly sourcePath: string;
		readonly generatedPath: string;
		readonly outputPath: string;
	},
): InlineConfig => ({
	define: { "globalThis.Bun": "undefined" },
	resolve: {
		alias: aliases,
		mainFields: ["browser", "module", "jsnext:main", "jsnext", "main"],
		conditions: ["deno", "worker", "browser", "import", "module", "default"],
	},
	build: {
		minify: false,
		target: "es2022",
		sourcemap: "inline",
		cssCodeSplit: false,
		modulePreload: false,
		lib: { entry, formats: ["es"], fileName: () => outputFile },
		rolldownOptions: {
			preserveEntrySignatures: "strict",
			external: (specifier: string) => approvedExternalSpecifiers.has(specifier),
			output: {
				format: "es",
				codeSplitting: false,
				entryFileNames: outputFile,
				sourcemapPathTransform: sourceMapPath(
					workspace.outputPath,
					workspace.sourcePath,
					workspace.generatedPath,
				),
			},
		},
	},
});

export const buildDenoEsm = Effect.fn("buildDenoEsm")(function* (options: DenoEsmBuildOptions) {
	return yield* Effect.scoped(
		Effect.gen(function* () {
			const workspace = yield* acquireCompilerWorkspace(options.workspaceOptions);
			let entry: string;
			if (options.sources !== undefined) {
				const stagedEntry = yield* Effect.fromResult(validateRelativePath(options.entry));
				yield* stageSourceFiles(workspace, options.sources);
				entry = resolve(workspace.sourcePath, stagedEntry);
			} else {
				entry = options.entry;
			}
			const result = yield* buildWithVite({
				workspace,
				typeScriptProject,
				config: denoConfig(
					entry,
					options.outputFile,
					options.aliases ?? [],
					options.approvedExternalSpecifiers,
					workspace,
				),
			});
			const output = result.files[0];
			if (result.files.length !== 1 || output?.path !== options.outputFile) {
				return yield* Effect.fail(
					diagnosticError(`Vite did not emit exactly ${options.outputFile}`),
				);
			}
			const javascript = new TextDecoder()
				.decode(output.bytes)
				.replace(
					"sourceMappingURL=data:application/json;charset=utf-8;base64,",
					"sourceMappingURL=data:application/json;base64,",
				)
				.replace(/^\/\/#region .*\/source\/(.+)$/gm, "//#region $1")
				.replace(/^\/\/#region .*\/generated\/(.+)$/gm, "//#region ryot:generated/$1");
			yield* Effect.fromResult(
				auditDenoEsmOutput(
					javascript,
					options.approvedExternalSpecifiers,
					options.approvedDynamicImportExpressions,
				),
			);
			return { javascript, diagnostics: result.diagnostics };
		}),
	);
});
