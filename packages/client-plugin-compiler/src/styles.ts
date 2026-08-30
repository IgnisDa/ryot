import { posix } from "node:path";

import { pluginClientAssetMimeType } from "@ryot-app/client-plugin-contract";
import { canonicalRelativePosixPathIssue } from "@ryot-app/ts-utils/path";
import { parse } from "postcss";
import valueParser from "postcss-value-parser";

import { isNeutralPluginModule, isTrustedClientModule } from "./dependencies";
import { type ClientPluginCompilerDiagnostic, clientPluginCompilerDiagnostic } from "./diagnostics";

const IMPORT_SPECIFIER =
	/(?:\bimport|\bexport)\s+(?:type\s+)?(?:(?:[^"'\n;]+?)\s+from\s+)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /\bimport\s*\(/;
const VITE_SPECIAL_IMPORT = /\bimport\.meta\.(?:glob|globEager)\s*\(/;
const NEW_URL = /\bnew\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g;

const sourceRoot = (path: string) => {
	const client = path.lastIndexOf("/client/");
	const shared = path.lastIndexOf("/shared/");
	const boundary = Math.max(client, shared);
	return boundary === -1 ? "" : path.slice(0, boundary + 1);
};

const isSharedSource = (path: string) => path.startsWith("shared/") || path.includes("/shared/");

const resolveRelative = (importer: string, specifier: string) =>
	posix.normalize(posix.join(posix.dirname(importer), specifier));

const allowedRelativeRoot = (importer: string, resolved: string) => {
	const root = sourceRoot(importer);
	return isSharedSource(importer)
		? resolved.startsWith(`${root}shared/`)
		: resolved.startsWith(`${root}client/`) || resolved.startsWith(`${root}shared/`);
};

const traversesSourceRoot = (importer: string, specifier: string) => {
	const rootDepth =
		sourceRoot(importer).split("/").filter(Boolean).length +
		(isSharedSource(importer) || importer.endsWith(".css") ? 1 : 0);
	let depth = posix.dirname(importer).split("/").filter(Boolean).length;
	for (const part of specifier.split("/")) {
		if (part === "..") {
			depth -= 1;
			if (depth < rootDepth) {
				return true;
			}
		} else if (part && part !== ".") {
			depth += 1;
		}
	}
	return false;
};

const importFailure = (path: string, message: string) =>
	clientPluginCompilerDiagnostic("RYOT_CLIENT_IMPORT", path, message);

const validateScript = (
	path: string,
	contents: string,
	files: Readonly<Record<string, Uint8Array>>,
	publicExports: Readonly<Record<string, string>>,
	unresolvedPluginDependencies: ReadonlySet<string>,
) => {
	const diagnostics: ClientPluginCompilerDiagnostic[] = [];
	if (DYNAMIC_IMPORT.test(contents) || VITE_SPECIAL_IMPORT.test(contents)) {
		diagnostics.push(
			importFailure(path, "Dynamic imports and Vite import-glob features are not allowed"),
		);
	}
	for (const match of contents.matchAll(IMPORT_SPECIFIER)) {
		const specifier = match[1];
		if (!specifier) {
			continue;
		}
		if (specifier.includes("?") || specifier.includes("#") || specifier.startsWith("/")) {
			diagnostics.push(
				importFailure(path, `Import "${specifier}" uses an unsupported import form`),
			);
			continue;
		}
		if (specifier.startsWith(".")) {
			const resolved = resolveRelative(path, specifier.replace(/\.js$/, ".ts"));
			if (
				traversesSourceRoot(path, specifier) ||
				!allowedRelativeRoot(path, resolved) ||
				canonicalRelativePosixPathIssue(resolved) !== null
			) {
				diagnostics.push(
					importFailure(
						path,
						`Import "${specifier}" could not be resolved inside the plugin ${isSharedSource(path) ? "shared" : "client"} sources`,
					),
				);
			}
			continue;
		}
		if (specifier.startsWith("@ryot-app/plugins/")) {
			const slug = /^@ryot-app\/plugins\/([^/]+)\//.exec(specifier)?.[1];
			if (
				isSharedSource(path) ||
				(publicExports[specifier] === undefined &&
					(slug === undefined || !unresolvedPluginDependencies.has(slug)))
			) {
				diagnostics.push(
					importFailure(
						path,
						isSharedSource(path)
							? `Import "${specifier}" is not allowed; plugin shared sources may only import Ryot plugin kit entry points`
							: `Public plugin import "${specifier}" is not present in the authorized export map`,
					),
				);
			}
			continue;
		}
		const allowed = isSharedSource(path)
			? isNeutralPluginModule(specifier)
			: isTrustedClientModule(specifier);
		if (!allowed) {
			diagnostics.push(
				importFailure(
					path,
					isSharedSource(path)
						? `Import "${specifier}" is not allowed; plugin shared sources may only import Ryot plugin kit entry points`
						: `Import "${specifier}" is not allowed; client plugins may only import React and Ryot client SDK entry points`,
				),
			);
		}
	}
	for (const match of contents.matchAll(NEW_URL)) {
		const specifier = match[1];
		const source = specifier?.split(/[?#]/, 1)[0] ?? "";
		const resolved = resolveRelative(path, source);
		if (
			!specifier?.startsWith(".") ||
			traversesSourceRoot(path, source) ||
			!allowedRelativeRoot(path, resolved) ||
			pluginClientAssetMimeType(resolved) === undefined ||
			files[resolved] === undefined
		) {
			diagnostics.push(importFailure(path, `Asset URL "${specifier ?? ""}" is not allowed`));
		}
	}
	return diagnostics;
};

class StylePolicyError extends Error {}

const validateStylesheet = (
	path: string,
	contents: string,
	files: Readonly<Record<string, Uint8Array>>,
) => {
	const diagnostics: ClientPluginCompilerDiagnostic[] = [];
	try {
		const root = parse(contents, { from: path });
		root.walkAtRules((rule) => {
			const name = rule.name.toLowerCase();
			if (name === "plugin" || name === "config" || name === "source") {
				throw new StylePolicyError(`Tailwind @${name} is compiler-owned and is not allowed`);
			}
			if (name === "import") {
				const parsed = valueParser(rule.params).nodes.find(
					(node) => node.type === "string" || node.type === "word",
				);
				const specifier = parsed?.value;
				if (!specifier || !specifier.startsWith(".")) {
					throw new StylePolicyError(
						`Stylesheet import "${specifier ?? rule.params}" is not allowed; client plugins may only import relative CSS files from client sources`,
					);
				}
				const resolved = resolveRelative(path, specifier);
				if (
					!allowedRelativeRoot(path, resolved) ||
					!resolved.endsWith(".css") ||
					files[resolved] === undefined
				) {
					throw new StylePolicyError(`Stylesheet import "${specifier}" is not allowed`);
				}
			}
		});
		root.walkDecls((declaration) => {
			const parsed = valueParser(declaration.value);
			parsed.walk((node) => {
				if (node.type !== "function" || node.value.toLowerCase() !== "url") {
					return;
				}
				const target = node.nodes.find((child) => child.type === "string" || child.type === "word");
				const specifier = target?.value;
				if (
					!specifier ||
					specifier.startsWith("#") ||
					specifier.startsWith("//") ||
					/^[a-z][\w+.-]*:/i.test(specifier)
				) {
					return;
				}
				if (specifier.startsWith("/")) {
					throw new StylePolicyError(`CSS asset URL "${specifier}" must not be root-relative`);
				}
				const source = specifier.split(/[?#]/, 1)[0] ?? "";
				const resolved = resolveRelative(path, source);
				if (traversesSourceRoot(path, source) || !allowedRelativeRoot(path, resolved)) {
					throw new StylePolicyError(
						`CSS asset URL "${specifier}" traverses outside the plugin client sources`,
					);
				}
				if (pluginClientAssetMimeType(resolved) === undefined) {
					throw new StylePolicyError(
						`CSS asset URL "${specifier}" does not use an allowed client asset extension`,
					);
				}
				if (files[resolved] === undefined) {
					throw new StylePolicyError(`CSS asset URL "${specifier}" does not exist`);
				}
			});
		});
	} catch (error) {
		diagnostics.push(
			clientPluginCompilerDiagnostic(
				"RYOT_CLIENT_STYLES",
				path,
				`Client plugin stylesheet is not allowed: ${String(error)}`,
			),
		);
	}
	return diagnostics;
};

export const validateClientSourcePolicy = ({
	files,
	sourceFiles,
	publicExports,
	unresolvedPluginDependencies = [],
}: {
	readonly files: Readonly<Record<string, Uint8Array>>;
	readonly sourceFiles: Readonly<Record<string, string>>;
	readonly publicExports: Readonly<Record<string, string>>;
	readonly unresolvedPluginDependencies?: readonly string[];
}) => {
	const unresolved = new Set(unresolvedPluginDependencies);
	return Object.entries(sourceFiles).flatMap(([path, contents]) => {
		if (/\.(?:test|spec)\.tsx?$/.test(path)) {
			return [];
		}
		return path.endsWith(".css")
			? validateStylesheet(path, contents, files)
			: validateScript(path, contents, files, publicExports, unresolved);
	});
};
