import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Effect } from "effect";

import { isNeutralPluginModule, isTrustedClientModule } from "./dependencies";
import {
	type ClientPluginCompilerDiagnostic,
	type ClientPluginCompilerFailure,
	clientPluginCompilationFailure,
	clientPluginCompilerDiagnostic,
} from "./diagnostics";

const CLIENT_SOURCE_ROOT = "client/";
const SHARED_SOURCE_ROOT = "shared/";
const CLIENT_NAMESPACE = "ryot-client-plugin";
const EFFECT_NAMESPACE = "ryot-client-plugin-effect";
const CLIENT_ENTRY_SPECIFIER = "ryot:client-entry";
const UNTRUSTED_NAMESPACE = "ryot-client-plugin-untrusted";

export type ClientPluginSources = {
	readonly entry: string;
	readonly files: Readonly<Record<string, string>>;
	readonly assetNames: Readonly<Record<string, string>>;
};

export type ClientBundleResult =
	| { readonly diagnostics: readonly ClientPluginCompilerDiagnostic[] }
	| {
			readonly javascript: string;
			readonly assets: readonly string[];
			readonly stylesheets: readonly string[];
	  };

const buildDiagnosticSeverity = (level: BuildMessage["level"]) => {
	if (level === "warning") {
		return "warning" as const;
	}
	if (level === "info") {
		return "info" as const;
	}
	return "error" as const;
};

const toBuildDiagnostic = (
	log: BuildMessage | ResolveMessage,
	entry: string,
): ClientPluginCompilerDiagnostic => ({
	message: log.message,
	code: "RYOT_CLIENT_BUNDLE",
	file: log.position?.file ?? entry,
	severity: buildDiagnosticSeverity(log.level),
	line: Math.max(1, log.position?.line ?? 1),
	column: Math.max(1, log.position?.column ?? 1),
	...(log.position === null ? {} : { length: log.position.length }),
});

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

const reachableRoots = (importer: string) =>
	importer.startsWith(SHARED_SOURCE_ROOT)
		? [SHARED_SOURCE_ROOT]
		: [CLIENT_SOURCE_ROOT, SHARED_SOURCE_ROOT];

const resolveLocalImport = (
	files: Readonly<Record<string, string>>,
	assetNames: Readonly<Record<string, string>>,
	importer: string,
	specifier: string,
) => {
	const path = normalizeRelativePath(importer, specifier);
	if (!path || !reachableRoots(importer).some((root) => path.startsWith(root))) {
		return null;
	}
	const candidates = [path, `${path}.tsx`, `${path}.ts`, `${path}/index.tsx`, `${path}/index.ts`];
	return (
		candidates.find(
			(candidate) => Object.hasOwn(files, candidate) || Object.hasOwn(assetNames, candidate),
		) ?? null
	);
};

const sourceLoader = (path: string) => (path.endsWith(".tsx") ? "tsx" : "ts");

export const bundleClientPlugin = (sources: ClientPluginSources, compilerRoot: string) =>
	Effect.suspend(() => {
		const assets = new Set<string>();
		const stylesheets = new Set<string>();
		const rejected: ClientPluginCompilerDiagnostic[] = [];

		const plugin: Bun.BunPlugin = {
			name: "ryot-client-plugin-source",
			setup(builder) {
				builder.onResolve({ filter: /^ryot:client-entry$/ }, () => ({
					path: sources.entry,
					namespace: CLIENT_NAMESPACE,
				}));
				builder.onResolve({ filter: /^\.{1,2}\// }, ({ path, importer }) => {
					if (!Object.hasOwn(sources.files, importer)) {
						return undefined;
					}
					const resolved = resolveLocalImport(sources.files, sources.assetNames, importer, path);
					if (resolved === null) {
						rejected.push(
							clientPluginCompilerDiagnostic(
								"RYOT_CLIENT_IMPORT",
								importer,
								`Import "${path}" could not be resolved inside the plugin client sources`,
							),
						);
						return { path, namespace: UNTRUSTED_NAMESPACE };
					}
					return { path: resolved, namespace: CLIENT_NAMESPACE };
				});
				builder.onResolve({ filter: /^[^.]/ }, ({ path, importer }) => {
					if (!Object.hasOwn(sources.files, importer)) {
						return undefined;
					}
					const shared = importer.startsWith(SHARED_SOURCE_ROOT);
					if (shared ? !isNeutralPluginModule(path) : !isTrustedClientModule(path)) {
						rejected.push(
							clientPluginCompilerDiagnostic(
								"RYOT_CLIENT_IMPORT",
								importer,
								shared
									? `Import "${path}" is not allowed; plugin shared sources may only import Ryot plugin kit entry points`
									: `Import "${path}" is not allowed; client plugins may only import React and Ryot client SDK entry points`,
							),
						);
						return { path, namespace: UNTRUSTED_NAMESPACE };
					}
					return { namespace: "file", path: Bun.resolveSync(path, compilerRoot) };
				});
				// Bun drops a barrel's re-exported bodies whenever the resolver above declines it, which
				// leaves the icon registry referencing bindings no module defines. Resolving it here keeps
				// the barrel linked and picks the ES module build over the CommonJS one Bun's own
				// resolution would prefer.
				builder.onResolve({ filter: /^lucide-react$/ }, () => ({
					namespace: "file",
					path: Bun.resolveSync("lucide-react/dist/esm/lucide-react.mjs", compilerRoot),
				}));
				builder.onResolve(
					{ filter: /^@tanstack\/(?:hotkeys|react-hotkeys|store)$/ },
					({ path }) => ({
						namespace: "file",
						path: Bun.resolveSync(path, compilerRoot),
					}),
				);
				// Bun drops namespace bindings when bundling these exports from the Effect barrel.
				builder.onResolve({ filter: /^effect$/ }, () => ({
					path: "effect",
					namespace: EFFECT_NAMESPACE,
				}));
				builder.onResolve(
					{ filter: /^effect\/(?:DateTime|Match|Result|Schema|SchemaGetter)$/ },
					({ path }) => ({
						namespace: "file",
						path: Bun.resolveSync(path, compilerRoot),
					}),
				);
				builder.onLoad({ filter: /.*/, namespace: EFFECT_NAMESPACE }, () => ({
					loader: "js" as const,
					contents: `
export * as DateTime from "effect/DateTime";
export * as Match from "effect/Match";
export * as Result from "effect/Result";
export * as Schema from "effect/Schema";
export * as SchemaGetter from "effect/SchemaGetter";
`,
				}));
				builder.onLoad({ filter: /.*/, namespace: UNTRUSTED_NAMESPACE }, () => ({
					contents: "",
					loader: "js" as const,
				}));
				builder.onLoad({ filter: /.*/, namespace: CLIENT_NAMESPACE }, ({ path }) => {
					const assetName = sources.assetNames[path];
					if (assetName !== undefined) {
						assets.add(path);
						return {
							loader: "js" as const,
							contents: `export default ${JSON.stringify(`./${assetName}`)};`,
						};
					}
					const source = sources.files[path];
					if (source === undefined) {
						rejected.push(
							clientPluginCompilerDiagnostic(
								"RYOT_CLIENT_IMPORT",
								sources.entry,
								`Client source "${path}" could not be loaded from the plugin package`,
							),
						);
						return { contents: "", loader: "js" as const };
					}
					if (path.endsWith(".css")) {
						stylesheets.add(path);
						return { contents: "", loader: "js" as const };
					}
					return { contents: source, loader: sourceLoader(path) };
				});
			},
		};

		return Effect.tryPromise({
			try: () =>
				Bun.build({
					throw: false,
					minify: true,
					format: "esm",
					splitting: false,
					plugins: [plugin],
					sourcemap: "none",
					target: "browser",
					packages: "bundle",
					entrypoints: [CLIENT_ENTRY_SPECIFIER],
					define: { "process.env.NODE_ENV": '"production"' },
				}),
			catch: (error) =>
				clientPluginCompilationFailure([
					clientPluginCompilerDiagnostic(
						"RYOT_CLIENT_BUNDLE",
						sources.entry,
						`Client plugin bundling failed: ${String(error)}`,
					),
				]),
		}).pipe(
			Effect.flatMap((result): Effect.Effect<ClientBundleResult, ClientPluginCompilerFailure> => {
				if (rejected.length > 0) {
					return Effect.succeed({ diagnostics: rejected });
				}
				if (!result.success) {
					return Effect.succeed({
						diagnostics: result.logs.map((log) => toBuildDiagnostic(log, sources.entry)),
					});
				}

				const outputs = result.outputs.filter((output) => output.kind === "entry-point");
				const output = outputs[0];
				if (outputs.length !== 1 || !output) {
					return Effect.succeed({
						diagnostics: [
							clientPluginCompilerDiagnostic(
								"RYOT_CLIENT_BUNDLE",
								sources.entry,
								"Client plugin compiler did not emit exactly one JavaScript module",
							),
						],
					});
				}

				return Effect.tryPromise({
					try: () => output.text(),
					catch: (error) =>
						clientPluginCompilationFailure([
							clientPluginCompilerDiagnostic(
								"RYOT_CLIENT_BUNDLE",
								sources.entry,
								`Compiled client JavaScript could not be read: ${String(error)}`,
							),
						]),
				}).pipe(
					Effect.map((javascript) => ({
						javascript,
						assets: sortBy([...assets]),
						stylesheets: sortBy([...stylesheets]),
					})),
				);
			}),
		);
	});
