import { posix, resolve } from "node:path";

import { BunFileSystem } from "@effect/platform-bun";
import type { PluginClientArtifact } from "@ryot-app/client-plugin-contract";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import {
	acquireCompilerWorkspace,
	buildWithVite,
	stageGeneratedFiles,
	ViteBuildService,
} from "@ryot-app/vite-compiler";
import tailwindcss from "@tailwindcss/vite";
import { Effect, Layer } from "effect";

import { clientArtifactFile, clientArtifactMetadata } from "./artifact";
import {
	CLIENT_DEPENDENCY_SPECIFIERS,
	resolveClientPluginCompilerDependencies,
} from "./dependencies";
import { clientPluginCompilationFailure, clientPluginCompilerDiagnostic } from "./diagnostics";
import { runtimeStylesheet } from "./generated-source";
import { clientTypeScriptProject } from "./semantic-check";

const compilerLayer = Layer.merge(BunFileSystem.layer, ViteBuildService.layer);
const CLIENT_RUNTIME_ARTIFACT_NAME = "client-plugin-runtime";
const RUNTIME_STYLESHEET = "runtime.css";
const DEFAULT_EXPORT_SPECIFIERS = new Set(["clsx", "react"]);

const failure = (message: string) =>
	clientPluginCompilationFailure([
		clientPluginCompilerDiagnostic("RYOT_CLIENT_RUNTIME", "client-runtime", message),
	]);

const toDiagnostic = (diagnostic: {
	readonly code?: string;
	readonly file?: string;
	readonly location?: { readonly line: number; readonly column: number };
	readonly message: string;
	readonly severity: "error" | "warning";
}) => ({
	message: diagnostic.message,
	severity: diagnostic.severity,
	code: diagnostic.code ?? "RYOT_CLIENT_RUNTIME",
	line: Math.max(1, diagnostic.location?.line ?? 1),
	column: Math.max(1, diagnostic.location?.column ?? 1),
	file: diagnostic.file?.replace(/^generated\//, "") ?? "client-runtime",
});

const generatedEntry = (specifier: string) =>
	[
		`export * from ${JSON.stringify(specifier)};`,
		...(specifier === "react"
			? [
					`export { Children, Component, Fragment, PureComponent, StrictMode, Suspense, cloneElement, createContext, createElement, createRef, forwardRef, isValidElement, lazy, memo, startTransition, use, useActionState, useCallback, useContext, useDebugValue, useDeferredValue, useEffect, useEffectEvent, useId, useImperativeHandle, useInsertionEffect, useLayoutEffect, useMemo, useOptimistic, useReducer, useRef, useState, useSyncExternalStore, useTransition } from "react";`,
				]
			: []),
		...(specifier === "react/jsx-runtime"
			? [`export { Fragment, jsx, jsxs } from "react/jsx-runtime";`]
			: []),
		...(specifier === "react-dom/client"
			? [`export { createRoot, hydrateRoot } from "react-dom/client";`]
			: []),
		...(DEFAULT_EXPORT_SPECIFIERS.has(specifier)
			? [`export { default } from ${JSON.stringify(specifier)};`]
			: []),
	].join("\n");

const generatedBootstrapSource = `
import { bootstrapClientPage, bootstrapClientPlugin, loadStylesheet } from "@ryot-app/client-sdk/plugin";

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value) => typeof value === "string";
const isModuleReference = (value) =>
	isRecord(value) && isString(value.specifier) && value.specifier.length > 0 && isString(value.binding) && value.binding.length > 0;
const isAutomaticRegistryEntry = (value) =>
	isRecord(value) && isString(value.ownerPluginId) && isString(value.entitySchemaSlug) && (value.layout === "grid" || value.layout === "list") && isModuleReference(value.module) && Array.isArray(value.stylesheets) && value.stylesheets.every(isString);
const isRoute = (value) => isRecord(value) && isString(value.path) && isModuleReference(value.module);
const isRouteRegistry = (value) =>
	isRecord(value) && isModuleReference(value.home) && Array.isArray(value.routes) && value.routes.every(isRoute) && (value.notFound === undefined || isModuleReference(value.notFound));
const isComposition = (value) =>
	isRecord(value) && Array.isArray(value.automaticRegistry) && value.automaticRegistry.every(isAutomaticRegistryEntry) && (value.application === "page" ? isModuleReference(value.entry) : value.application === "plugin-route" && isRouteRegistry(value.routes));

const descriptorElement = document.getElementById("ryot-client-composition");
if (!(descriptorElement instanceof HTMLScriptElement) || descriptorElement.type !== "application/json") {
	throw new Error("Client composition descriptor is missing or has an invalid type");
}
let descriptorValue;
try {
	descriptorValue = JSON.parse(descriptorElement.textContent ?? "");
} catch {
	throw new Error("Client composition descriptor is not valid JSON");
}
if (!isComposition(descriptorValue)) {
	throw new Error("Client composition descriptor has an invalid shape");
}

const modulePromisesBySpecifier = new Map();
const load = (specifier) => {
	if (!modulePromisesBySpecifier.has(specifier)) {
		modulePromisesBySpecifier.set(specifier, import(/* @vite-ignore */ specifier));
	}
	return modulePromisesBySpecifier.get(specifier);
};
const routeReferences = descriptorValue.application === "plugin-route"
	? [descriptorValue.routes.home, ...descriptorValue.routes.routes.map((route) => route.module), ...(descriptorValue.routes.notFound === undefined ? [] : [descriptorValue.routes.notFound])]
	: [];
const moduleReferences = [
	...(descriptorValue.application === "page" ? [descriptorValue.entry] : []),
	...routeReferences,
];
const modules = new Map(await Promise.all(
	[...new Set(moduleReferences.map(({ specifier }) => specifier))].map(async (specifier) => [specifier, await load(specifier)]),
));
const binding = (reference) => {
	const module = modules.get(reference.specifier);
	if (!module || !Object.hasOwn(module, reference.binding) || module[reference.binding] === undefined) {
		throw new Error("Client composition export is missing: " + reference.specifier + "#" + reference.binding);
	}
	return module[reference.binding];
};
const entityPresentations = descriptorValue.automaticRegistry.map((registration) => ({
	ownerPluginId: registration.ownerPluginId,
	entitySchemaSlug: registration.entitySchemaSlug,
	layout: registration.layout,
	load: async () => {
		await Promise.all(registration.stylesheets.map(loadStylesheet));
		const module = await load(registration.module.specifier);
		const reference = registration.module;
		if (!Object.hasOwn(module, reference.binding) || module[reference.binding] === undefined) {
			throw new Error("Client composition export is missing: " + reference.specifier + "#" + reference.binding);
		}
		return module[reference.binding];
	},
}));

if (descriptorValue.application === "page") {
	bootstrapClientPage(binding(descriptorValue.entry), { entityPresentations });
} else {
	const routeRegistry = descriptorValue.routes;
	bootstrapClientPlugin({
		home: { component: binding(routeRegistry.home) },
		routes: routeRegistry.routes.map((route) => ({ path: route.path, component: binding(route.module) })),
		...(routeRegistry.notFound === undefined ? {} : { notFound: binding(routeRegistry.notFound) }),
	}, { entityPresentations });
}
`;

const isExternalReference = (reference: string) =>
	reference.startsWith("#") ||
	reference.startsWith("data:") ||
	reference.startsWith("//") ||
	/^[a-z][\w+.-]*:/i.test(reference);

const localReferencePath = (from: string, reference: string) => {
	const target = reference.split(/[?#]/, 1)[0] ?? "";
	if (target.startsWith("/")) {
		return undefined;
	}
	const path = posix.normalize(posix.join(posix.dirname(from), target));
	return path === ".." || path.startsWith("../") ? undefined : path;
};

type OutputReference = {
	readonly kind: "module" | "asset" | "css" | "css-import";
	readonly reference: string;
};

const skipTrivia = (contents: string, start: number) => {
	let index = start;
	while (index < contents.length) {
		if (/\s/.test(contents[index] ?? "")) {
			index += 1;
		} else if (contents.startsWith("//", index)) {
			const lineEnd = contents.indexOf("\n", index + 2);
			index = lineEnd === -1 ? contents.length : lineEnd + 1;
		} else if (contents.startsWith("/*", index)) {
			const commentEnd = contents.indexOf("*/", index + 2);
			index = commentEnd === -1 ? contents.length : commentEnd + 2;
		} else {
			break;
		}
	}
	return index;
};

const readQuoted = (contents: string, start: number) => {
	const quote = contents[start];
	if (quote !== "'" && quote !== '"' && quote !== "`") {
		return undefined;
	}
	let index = start + 1;
	while (index < contents.length) {
		if (contents[index] === "\\") {
			index += 2;
		} else if (contents[index] === quote) {
			return { end: index + 1, value: contents.slice(start + 1, index) };
		} else {
			index += 1;
		}
	}
	return undefined;
};

const readWord = (contents: string, start: number) => {
	const match = /^[A-Za-z_$][\w$]*/.exec(contents.slice(start));
	return match?.[0];
};

const javascriptReferences = (contents: string): OutputReference[] => {
	const references: OutputReference[] = [];
	let index = 0;
	while (index < contents.length) {
		const current = contents[index];
		if (current === "'" || current === '"' || current === "`") {
			index = readQuoted(contents, index)?.end ?? contents.length;
			continue;
		}
		if (contents.startsWith("//", index) || contents.startsWith("/*", index)) {
			index = skipTrivia(contents, index);
			continue;
		}
		const word = readWord(contents, index);
		if (word === undefined) {
			index += 1;
			continue;
		}
		const wordEnd = index + word.length;
		if (word === "import" || word === "export") {
			if (contents[index - 1] === ".") {
				index = wordEnd;
				continue;
			}
			let cursor = skipTrivia(contents, wordEnd);
			const next = contents[cursor];
			if (word === "import" && next === ".") {
				index = wordEnd;
				continue;
			}
			if (word === "export" && next !== "{" && next !== "*") {
				index = wordEnd;
				continue;
			}
			if (
				word === "import" &&
				next !== "(" &&
				next !== "'" &&
				next !== '"' &&
				next !== "{" &&
				next !== "*" &&
				!/[A-Za-z_$]/.test(next ?? "")
			) {
				index = wordEnd;
				continue;
			}
			if (word === "import" && next === "(") {
				const literal = readQuoted(contents, skipTrivia(contents, cursor + 1));
				if (literal) {
					references.push({ kind: "module", reference: literal.value });
				}
				index = wordEnd;
				continue;
			}
			if (word === "import" && (next === "'" || next === '"')) {
				const literal = readQuoted(contents, cursor);
				if (literal) {
					references.push({ kind: "module", reference: literal.value });
				}
				index = wordEnd;
				continue;
			}
			while (cursor < contents.length && contents[cursor] !== ";") {
				const token = readWord(contents, cursor);
				if (token === "from") {
					const literal = readQuoted(contents, skipTrivia(contents, cursor + token.length));
					if (literal) {
						references.push({ kind: "module", reference: literal.value });
					}
					break;
				}
				const quoted = readQuoted(contents, cursor);
				if (quoted) {
					cursor = quoted.end;
				} else {
					cursor += token?.length ?? 1;
				}
				cursor = skipTrivia(contents, cursor);
			}
			index = wordEnd;
			continue;
		}
		if (word === "new") {
			const urlStart = skipTrivia(contents, wordEnd);
			if (contents.startsWith("URL", urlStart)) {
				const open = skipTrivia(contents, urlStart + 3);
				if (contents[open] === "(") {
					const literal = readQuoted(contents, skipTrivia(contents, open + 1));
					const afterLiteral = literal ? skipTrivia(contents, literal.end) : contents.length;
					if (
						literal?.value.startsWith(".") &&
						contents[afterLiteral] === "," &&
						contents.slice(skipTrivia(contents, afterLiteral + 1)).startsWith("import.meta.url")
					) {
						references.push({ kind: "asset", reference: literal.value });
					}
				}
			}
		}
		index = wordEnd;
	}
	return references;
};

const validateOutputReferences = (
	files: readonly {
		readonly path: string;
		readonly bytes: Uint8Array;
		readonly contentType: string;
	}[],
) => {
	const filesByName = new Map(files.map((file) => [file.path, file]));
	const decoder = new TextDecoder();
	for (const file of files) {
		if (!file.contentType.startsWith("text/")) {
			continue;
		}
		const contents = decoder.decode(file.bytes);
		const references: readonly OutputReference[] = file.contentType.startsWith("text/javascript")
			? javascriptReferences(contents)
			: [
					...Array.from(contents.matchAll(/url\(\s*["']?([^"')]+)/gi), (match) => ({
						kind: "css" as const,
						reference: match[1] ?? "",
					})),
					...Array.from(
						contents.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s]+)["']?\s*\)?/gi),
						(match) => ({ reference: match[1] ?? "", kind: "css-import" as const }),
					),
				];
		for (const { kind, reference } of references) {
			if (kind === "module" && isExternalReference(reference) && !reference.startsWith("data:")) {
				return `JavaScript output "${file.path}" retains external module import "${reference}"`;
			}
			if (!reference || isExternalReference(reference)) {
				continue;
			}
			const path = localReferencePath(file.path, reference);
			if (path === undefined || !filesByName.has(path)) {
				return `Emitted file "${file.path}" references missing or escaping path "${reference}"`;
			}
			if (
				file.contentType.startsWith("text/javascript") &&
				kind === "module" &&
				!path.endsWith(".js")
			) {
				return `JavaScript output "${file.path}" imports a non-JavaScript module "${reference}"`;
			}
			if (
				file.contentType.startsWith("text/css") &&
				kind === "css-import" &&
				path.endsWith(".js")
			) {
				return `CSS output "${file.path}" imports JavaScript module "${reference}"`;
			}
		}
	}
	return null;
};

export const buildClientRuntime = () =>
	Effect.gen(function* () {
		const dependencies = yield* resolveClientPluginCompilerDependencies;
		const workspace = yield* acquireCompilerWorkspace({
			parentPath: dependencies.compilerRoot,
		}).pipe(Effect.mapError((error) => failure(error.message)));
		const bootstrapFileName = "entry-bootstrap.js";
		const entries: Record<string, string> = Object.fromEntries([
			...CLIENT_DEPENDENCY_SPECIFIERS.map((specifier, index) => [specifier, `entry-${index}.js`]),
			["bootstrap", bootstrapFileName],
		]);
		yield* stageGeneratedFiles(workspace, [
			...CLIENT_DEPENDENCY_SPECIFIERS.map((specifier, index) => ({
				path: `entries/entry-${index}.ts`,
				contents: generatedEntry(specifier),
			})),
			{ path: "bootstrap.ts", contents: generatedBootstrapSource },
			{ path: RUNTIME_STYLESHEET, contents: runtimeStylesheet },
		]).pipe(Effect.mapError((error) => failure(error.message)));

		const bundled = yield* buildWithVite({
			workspace,
			root: workspace.generatedPath,
			typeScriptProject: clientTypeScriptProject,
			config: {
				base: "./",
				mode: "production",
				plugins: tailwindcss(),
				oxc: { jsx: { development: false } },
				envPrefix: "__RYOT_CLIENT_RUNTIME_NO_ENV__",
				define: { "import.meta.env": "{}", "process.env.NODE_ENV": JSON.stringify("production") },
				resolve: {
					dedupe: ["react", "react-dom", "@ryot-app/client-sdk", "@ryot-app/client-ui-sdk"],
				},
				build: {
					minify: true,
					target: "es2022",
					cssCodeSplit: true,
					assetsInlineLimit: 0,
					modulePreload: false,
					rolldownOptions: {
						preserveEntrySignatures: "strict",
						output: {
							format: "es",
							entryFileNames: "entry-[name].js",
							chunkFileNames: "chunk-[hash].js",
							assetFileNames: ({ names }) =>
								names.some((name) => name.endsWith(".css"))
									? RUNTIME_STYLESHEET
									: "asset-[hash][extname]",
						},
						input: Object.fromEntries([
							...CLIENT_DEPENDENCY_SPECIFIERS.map((_, index) => [
								String(index),
								resolve(workspace.generatedPath, `entries/entry-${index}.ts`),
							]),
							["bootstrap", resolve(workspace.generatedPath, "bootstrap.ts")],
							["styles", resolve(workspace.generatedPath, RUNTIME_STYLESHEET)],
						]),
					},
				},
			},
		}).pipe(
			Effect.mapError((error) =>
				clientPluginCompilationFailure(
					(error.diagnostics ?? []).some(({ severity }) => severity === "error")
						? (error.diagnostics ?? [])
								.filter(({ severity }) => severity === "error")
								.map(toDiagnostic)
						: failure(error.message).diagnostics,
				),
			),
		);
		const emittedErrors = bundled.diagnostics
			.filter(({ severity }) => severity === "error")
			.map(toDiagnostic);
		if (emittedErrors.length > 0) {
			return yield* clientPluginCompilationFailure(emittedErrors);
		}

		const files = sortBy(bundled.files.map(clientArtifactFile), ({ name }) => name);
		for (const [index, specifier] of CLIENT_DEPENDENCY_SPECIFIERS.entries()) {
			const name = entries[specifier];
			const output = files.find((file) => file.name === name);
			if (name !== `entry-${index}.js` || !output?.contentType.startsWith("text/javascript")) {
				return yield* failure(`Vite did not emit the runtime entry for "${specifier}"`);
			}
		}
		const bootstrapName = entries["bootstrap"];
		const bootstrapOutput = files.find((file) => file.name === bootstrapName);
		if (
			bootstrapName !== bootstrapFileName ||
			!bootstrapOutput?.contentType.startsWith("text/javascript")
		) {
			return yield* failure("Vite did not emit the client runtime bootstrap entry");
		}
		if (!files.some((file) => file.name === RUNTIME_STYLESHEET)) {
			return yield* failure("Vite did not emit the client runtime stylesheet");
		}
		const missingReference = validateOutputReferences(bundled.files);
		if (missingReference) {
			return yield* failure(missingReference);
		}
		const metadata = clientArtifactMetadata(CLIENT_RUNTIME_ARTIFACT_NAME, files);
		const artifact: PluginClientArtifact = { ...metadata, files };
		return { entries, artifact };
	}).pipe(Effect.provide(compilerLayer), Effect.scoped);
