import {
	clientArtifactFile,
	type ClientRuntimeArtifact,
	clientRuntimeArtifactMetadata,
} from "@ryot-app/plugin-client-contract";
import { decodeExecutableText } from "@ryot-app/ts-utils/executable-text";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { posixPath } from "@ryot-app/ts-utils/path";
import { inspectJavaScriptReferences } from "@ryot-app/typescript-compiler/javascript-references";
import { acquireCompilerWorkspace, buildWithVite } from "@ryot-app/vite-compiler";
import tailwindcss from "@tailwindcss/vite";
import { Effect, Path } from "effect";

import {
	CLIENT_DEPENDENCY_SPECIFIERS,
	resolveClientPluginCompilerDependencies,
} from "./dependencies";
import { clientPluginCompilationFailure, clientPluginCompilerDiagnostic } from "./diagnostics";
import { runtimeStylesheet } from "./generated-source";
import { cssOutputReferences } from "./output-references";
import { isExternalReference, referencePath } from "./reference-path";
import { clientTypeScriptProject } from "./semantic-check";

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

const generatedBootstrapSource = `import { bootstrapComposition } from "@ryot-app/plugin-client-sdk/bootstrap";
await bootstrapComposition();
`;

const localReferencePath = (from: string, reference: string) => {
	const target = referencePath(reference);
	if (target.startsWith("/")) {
		return undefined;
	}
	const path = posixPath.join(posixPath.dirname(from), target);
	return path === ".." || path.startsWith("../") ? undefined : path;
};

const validateOutputReferences = (
	files: readonly {
		readonly path: string;
		readonly bytes: Uint8Array;
		readonly contentType: string;
	}[],
) => {
	const filesByName = new Map(files.map((file) => [file.path, file]));
	for (const file of files) {
		if (!file.contentType.startsWith("text/")) {
			continue;
		}
		const contents = decodeExecutableText(file.bytes);
		const references = file.contentType.startsWith("text/javascript")
			? (() => {
					const parsed = inspectJavaScriptReferences(contents);
					return [
						...parsed.imports.map((reference) => ({ reference, kind: "module" as const })),
						...parsed.assets.map((reference) => ({ reference, kind: "asset" as const })),
					];
				})()
			: cssOutputReferences(contents, file.path);
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

export const buildClientRuntime = Effect.gen(function* () {
	const path = yield* Path.Path;
	const dependencies = yield* resolveClientPluginCompilerDependencies;
	const workspace = yield* acquireCompilerWorkspace({
		parentPath: dependencies.compilerRoot,
		generated: [
			...CLIENT_DEPENDENCY_SPECIFIERS.map((specifier, index) => ({
				path: `entries/entry-${index}.ts`,
				contents: generatedEntry(specifier),
			})),
			{ path: "bootstrap.ts", contents: generatedBootstrapSource },
			{ path: RUNTIME_STYLESHEET, contents: runtimeStylesheet },
		],
	}).pipe(Effect.mapError((error) => failure(error.message)));
	const bootstrapFileName = "entry-bootstrap.js";
	const entries: Record<string, string> = Object.fromEntries([
		...CLIENT_DEPENDENCY_SPECIFIERS.map((specifier, index) => [specifier, `entry-${index}.js`]),
		["bootstrap", bootstrapFileName],
	]);

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
			define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"production"' },
			resolve: {
				dedupe: ["react", "react-dom", "@ryot-app/plugin-client-sdk", "@ryot-app/plugin-ui-sdk"],
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
							path.resolve(workspace.generatedPath, `entries/entry-${index}.ts`),
						]),
						["bootstrap", path.resolve(workspace.generatedPath, "bootstrap.ts")],
						["styles", path.resolve(workspace.generatedPath, RUNTIME_STYLESHEET)],
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
	const missingReference = yield* Effect.try({
		try: () => validateOutputReferences(bundled.files),
		catch: () => failure("Client runtime emitted invalid text or syntax"),
	});
	if (missingReference) {
		return yield* failure(missingReference);
	}
	const metadata = clientRuntimeArtifactMetadata(CLIENT_RUNTIME_ARTIFACT_NAME, files);
	const artifact: ClientRuntimeArtifact = { ...metadata, files };
	return { entries, artifact };
}).pipe(Effect.scoped);
