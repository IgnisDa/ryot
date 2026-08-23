import { pluginClientAssetMimeType } from "@ryot-app/client-plugin-contract";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { canonicalRelativePosixPathIssue } from "@ryot-app/ts-utils/path";
import { Scanner } from "@tailwindcss/oxide";
import { Effect } from "effect";
import { parse } from "postcss";
import valueParser from "postcss-value-parser";
import { compile } from "tailwindcss";

import { clientPluginCompilationFailure, clientPluginCompilerDiagnostic } from "./diagnostics";

type ScanSource = { readonly content: string; readonly extension: string };
type StylesheetSource = { readonly content: string; readonly path: string };

type CompileClientStylesInput = {
	readonly entry: string;
	readonly fontStylesheet: string;
	readonly themeStylesheet: string;
	readonly paletteStylesheet: string;
	readonly scanSources: readonly ScanSource[];
	readonly tailwindStylesheet: StylesheetSource;
	readonly stylesheets: readonly StylesheetSource[];
	readonly files: Readonly<Record<string, Uint8Array>>;
	readonly assetNames: Readonly<Record<string, string>>;
	readonly sourceFiles: Readonly<Record<string, string>>;
};

const clientBaseStylesheet = `@layer base {
	/* Vertical only: suppressing the x axis would disable the browser's own back-swipe. */
	html,
	body {
		height: 100%;
		margin: 0;
		overflow: hidden;
		overscroll-behavior-y: none;
		-webkit-tap-highlight-color: transparent;
	}

	body {
		background: var(--bg);
		font-family: var(--font-family-ui);
	}

	#app {
		height: 100%;
		isolation: isolate;
		overflow: hidden;
		position: relative;
	}
}`;

const directoryOf = (path: string) => path.slice(0, path.lastIndexOf("/"));

const clientRoot = (path: string) => {
	const boundary = path.lastIndexOf("/client/");
	return boundary === -1 ? "client/" : `${path.slice(0, boundary + 1)}client/`;
};

const resolveClientStylesheet = (
	id: string,
	base: string,
	files: Readonly<Record<string, string>>,
) => {
	if (!/^\.{1,2}\//.test(id)) {
		return null;
	}

	const parts = base.split("/").filter(Boolean);
	for (const part of id.split("/")) {
		if (!part || part === ".") {
			continue;
		}
		if (part === "..") {
			if (parts.length === 0) {
				return null;
			}
			parts.pop();
			continue;
		}
		parts.push(part);
	}

	const path = parts.join("/");
	return path.startsWith(clientRoot(base)) && path.endsWith(".css") && Object.hasOwn(files, path)
		? path
		: null;
};

class ClientStyleAssetError extends Error {
	constructor(
		readonly path: string,
		message: string,
	) {
		super(message);
	}
}

const resolveAssetPath = (stylesheet: string, specifier: string) => {
	const suffixIndex = specifier.search(/[?#]/);
	const sourcePath = suffixIndex === -1 ? specifier : specifier.slice(0, suffixIndex);
	const suffix = suffixIndex === -1 ? "" : specifier.slice(suffixIndex);
	const normalized = directoryOf(stylesheet).split("/");
	const root = clientRoot(stylesheet);
	for (const part of sourcePath.split("/")) {
		if (!part || part === ".") {
			continue;
		}
		if (part === "..") {
			if (normalized.join("/").length <= root.length - 1) {
				return null;
			}
			normalized.pop();
			continue;
		}
		normalized.push(part);
	}
	const path = normalized.join("/");
	return path.startsWith(root) ? { suffix, path } : null;
};

const rewriteStylesheetAssets = (
	path: string,
	content: string,
	files: Readonly<Record<string, Uint8Array>>,
	assetNames: Readonly<Record<string, string>>,
	assets: Set<string>,
) => {
	const root = parse(content, { from: path });
	root.walkDecls((declaration) => {
		const parsed = valueParser(declaration.value);
		parsed.walk((node) => {
			if (node.type !== "function" || node.value.toLowerCase() !== "url") {
				return;
			}
			const values = node.nodes.filter(
				(child) => child.type !== "space" && child.type !== "comment" && child.type !== "div",
			);
			const target = values[0];
			if (values.length !== 1 || (target?.type !== "string" && target?.type !== "word")) {
				throw new ClientStyleAssetError(path, `CSS URL in "${path}" must contain one path`);
			}

			const specifier = target.value;
			if (
				specifier.startsWith("#") ||
				specifier.startsWith("//") ||
				/^[a-z][a-z\d+.-]*:/i.test(specifier)
			) {
				return;
			}
			if (specifier.startsWith("/")) {
				throw new ClientStyleAssetError(
					path,
					`CSS asset URL "${specifier}" from "${path}" must not be root-relative`,
				);
			}

			const resolved = resolveAssetPath(path, specifier);
			if (
				resolved === null ||
				!resolved.path.startsWith(clientRoot(path)) ||
				canonicalRelativePosixPathIssue(resolved.path) !== null
			) {
				throw new ClientStyleAssetError(
					path,
					`CSS asset URL "${specifier}" from "${path}" traverses outside the plugin client sources`,
				);
			}
			if (pluginClientAssetMimeType(resolved.path) === undefined) {
				throw new ClientStyleAssetError(
					path,
					`CSS asset URL "${specifier}" from "${path}" does not use an allowed client asset extension`,
				);
			}
			if (!Object.hasOwn(files, resolved.path)) {
				throw new ClientStyleAssetError(
					path,
					`CSS asset URL "${specifier}" from "${path}" does not exist`,
				);
			}

			const assetName = assetNames[resolved.path];
			if (assetName === undefined) {
				throw new ClientStyleAssetError(path, `CSS asset "${resolved.path}" could not be emitted`);
			}
			assets.add(resolved.path);
			target.value = `./${assetName}${resolved.suffix}`;
		});
		declaration.value = valueParser.stringify(parsed.nodes);
	});
	return root.toString();
};

export const compileClientStyles = ({
	entry,
	files,
	assetNames,
	sourceFiles,
	scanSources,
	stylesheets,
	fontStylesheet,
	themeStylesheet,
	paletteStylesheet,
	tailwindStylesheet,
}: CompileClientStylesInput) =>
	Effect.tryPromise({
		try: async () => {
			const assets = new Set<string>();
			const rewrittenFiles: Record<string, string> = {};
			const rewrite = (path: string, content: string) =>
				(rewrittenFiles[path] ??= rewriteStylesheetAssets(
					path,
					content,
					files,
					assetNames,
					assets,
				));
			const stylesheetImports = stylesheets
				.map((_, index) => `@import "ryot:stylesheet/${index}";`)
				.join("\n");
			const inputStylesheet = `@import "tailwindcss";\n${fontStylesheet}\n${clientBaseStylesheet}\n${stylesheetImports}\n${themeStylesheet}\n${paletteStylesheet}`;
			let tailwindLoaded = false;
			const compiled = await compile(inputStylesheet, {
				base: "client",
				loadStylesheet: (id, base) =>
					Promise.resolve().then(() => {
						if (id === "tailwindcss") {
							const content = tailwindLoaded ? "" : tailwindStylesheet.content;
							tailwindLoaded = true;
							return {
								content,
								path: tailwindStylesheet.path,
								base: directoryOf(tailwindStylesheet.path),
							};
						}
						const generatedIndex = id.match(/^ryot:stylesheet\/(\d+)$/)?.[1];
						if (generatedIndex !== undefined) {
							const source = stylesheets[Number(generatedIndex)];
							if (source !== undefined) {
								return {
									path: source.path,
									base: directoryOf(source.path),
									content: rewrite(source.path, source.content),
								};
							}
						}

						const path = resolveClientStylesheet(id, base, sourceFiles);
						if (path === null) {
							throw new Error(
								`Stylesheet import "${id}" from "${base}" is not allowed; client plugins may only import "tailwindcss" and relative CSS files from client sources`,
							);
						}
						return {
							path,
							base: directoryOf(path),
							content: rewrite(path, sourceFiles[path] ?? ""),
						};
					}),
			});
			const candidates = new Scanner({}).scanFiles([...scanSources]);
			return {
				assets: sortBy([...assets]),
				sources: sortBy(Object.keys(rewrittenFiles)),
				css: compiled.build(sortBy(candidates)),
			};
		},
		catch: (error) =>
			clientPluginCompilationFailure([
				clientPluginCompilerDiagnostic(
					"RYOT_CLIENT_STYLES",
					error instanceof ClientStyleAssetError ? error.path : entry,
					`Client plugin stylesheet could not be compiled: ${String(error)}`,
				),
			]),
	});
