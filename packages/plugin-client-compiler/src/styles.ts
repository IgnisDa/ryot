import { pluginClientAssetMimeType } from "@ryot-app/plugin-client-contract";
import { canonicalRelativePosixPathIssue, posixPath } from "@ryot-app/ts-utils/path";
import { inspectTypeScriptReferences } from "@ryot-app/typescript-compiler/typescript-references";
import { parse } from "postcss";
import valueParser from "postcss-value-parser";
import * as ts from "typescript/unstable/ast";

import { isNeutralPluginModule, isTrustedClientModule, PLUGIN_IMPORT } from "./dependencies";
import { type ClientPluginCompilerDiagnostic, clientPluginCompilerDiagnostic } from "./diagnostics";
import { isClientSourcePath, isSharedSourcePath } from "./planning";

const isSharedSource = (path: string) => path.startsWith("shared/");

const resolveRelative = (importer: string, specifier: string) =>
	posixPath.join(posixPath.dirname(importer), specifier);

const allowedRelativeRoot = (importer: string, resolved: string) =>
	isSharedSourcePath(importer)
		? isSharedSourcePath(resolved)
		: isClientSourcePath(resolved) || isSharedSourcePath(resolved);

const traversesSourceRoot = (importer: string, specifier: string) => {
	const rootDepth = isSharedSourcePath(importer) || importer.endsWith(".css") ? 1 : 0;
	let depth = posixPath.dirname(importer).split("/").filter(Boolean).length;
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

const isImportGlob = (meta: ts.MetaProperty) => {
	const access = meta.parent;
	let name: string | null = null;
	if (ts.isPropertyAccessExpression(access)) {
		name = access.name.text;
	} else if (
		ts.isElementAccessExpression(access) &&
		ts.isStringLiteralLikeNode(access.argumentExpression)
	) {
		name = access.argumentExpression.text;
	}
	return (
		(name === "glob" || name === "globEager") &&
		ts.isCallExpression(access.parent) &&
		access.parent.expression === access
	);
};

const validateScript = (
	path: string,
	file: ts.SourceFile,
	files: Readonly<Record<string, Uint8Array>>,
	unresolvedPluginDependencies: ReadonlySet<string>,
) => {
	const diagnostics: ClientPluginCompilerDiagnostic[] = [];
	const validateImport = (specifier: string) => {
		if (specifier.includes("?") || specifier.includes("#") || specifier.startsWith("/")) {
			diagnostics.push(
				importFailure(path, `Import "${specifier}" uses an unsupported import form`),
			);
			return;
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
			return;
		}
		if (specifier.startsWith("@ryot-app/plugins/")) {
			const slug = PLUGIN_IMPORT.exec(specifier)?.[1];
			if (
				isSharedSource(path) ||
				slug === undefined ||
				!unresolvedPluginDependencies.has(slug)
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
			return;
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
	};
	const validateAsset = (specifier: string) => {
		const source = specifier.split(/[?#]/, 1)[0] ?? "";
		const resolved = resolveRelative(path, source);
		if (
			!specifier.startsWith(".") ||
			traversesSourceRoot(path, source) ||
			!allowedRelativeRoot(path, resolved) ||
			pluginClientAssetMimeType(resolved) === undefined ||
			files[resolved] === undefined
		) {
			diagnostics.push(importFailure(path, `Asset URL "${specifier}" is not allowed`));
		}
	};
	for (const reference of inspectTypeScriptReferences(file)) {
		if (reference.kind === "dynamic-import") {
			diagnostics.push(
				importFailure(path, "Dynamic imports and Vite import-glob features are not allowed"),
			);
		} else if (reference.kind === "import-meta") {
			if (ts.isNewExpression(reference.node)) {
				if (reference.specifier === null) {
					diagnostics.push(importFailure(path, "Asset URLs must use a static string"));
				} else {
					validateAsset(reference.specifier);
				}
			} else if (isImportGlob(reference.node)) {
				diagnostics.push(
					importFailure(path, "Dynamic imports and Vite import-glob features are not allowed"),
				);
			}
		} else if (reference.kind !== "import-equals-alias" && reference.specifier !== null) {
			validateImport(reference.specifier);
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
	parsedFiles,
	unresolvedPluginDependencies = [],
}: {
	readonly files: Readonly<Record<string, Uint8Array>>;
	readonly sourceFiles: Readonly<Record<string, string>>;
	readonly parsedFiles: Readonly<Record<string, ts.SourceFile>>;
	readonly unresolvedPluginDependencies?: readonly string[];
}) => {
	const unresolved = new Set(unresolvedPluginDependencies);
	return Object.entries(sourceFiles).flatMap(([path, contents]) => {
		if (/\.(?:test|spec)\.tsx?$/.test(path)) {
			return [];
		}
		if (path.endsWith(".css")) {
			return validateStylesheet(path, contents, files);
		}
		const file = parsedFiles[path];
		return file
			? validateScript(path, file, files, unresolved)
			: [importFailure(path, "Script source was not parsed")];
	});
};
