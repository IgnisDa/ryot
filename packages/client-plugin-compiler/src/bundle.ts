import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Effect } from "effect";

import { isTrustedClientModule } from "./dependencies";
import {
	type ClientPluginCompilerDiagnostic,
	type ClientPluginCompilerFailure,
	clientPluginCompilationFailure,
	clientPluginCompilerDiagnostic,
} from "./diagnostics";
import {
	clientImportPolicyIssue,
	isSharedClientSource,
	resolveClientLocalImport,
} from "./import-policy";
import type { ClientCompilerBenchmarkInstrumentation } from "./instrumentation";
import {
	createStylexTracerBundleAdapter,
	STYLEX_RUNTIME_MODULE,
	STYLEX_TRACER_TRUSTED_MODULES,
	type StylexTracerRule,
} from "./stylex-tracer";

const CLIENT_NAMESPACE = "ryot-client-plugin";
const EFFECT_NAMESPACE = "ryot-client-plugin-effect";
const CLIENT_ENTRY_SPECIFIER = "ryot:client-entry";
const UNTRUSTED_NAMESPACE = "ryot-client-plugin-untrusted";
const STYLEX_TRUSTED_NAMESPACE = "ryot-client-plugin-stylex-trusted";

export type ClientPluginSources = {
	readonly entry: string;
	readonly files: Readonly<Record<string, string>>;
	readonly assetNames: Readonly<Record<string, string>>;
	readonly publicExports: Readonly<Record<string, string>>;
	readonly unresolvedPluginDependencies?: readonly string[];
	readonly stylexTracer?: { readonly fingerprint: string };
};

export type ClientBundleResult =
	| { readonly diagnostics: readonly ClientPluginCompilerDiagnostic[] }
	| {
			readonly javascript: string;
			readonly assets: readonly string[];
			readonly sources: readonly string[];
			readonly stylesheets: readonly string[];
			readonly publicExports: readonly string[];
			readonly stylexRules?: readonly StylexTracerRule[];
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
	line: Math.max(1, log.position?.line ?? 1),
	severity: buildDiagnosticSeverity(log.level),
	column: Math.max(1, log.position?.column ?? 1),
	...(log.position === null ? {} : { length: log.position.length }),
});

const sourceLoader = (path: string) => (path.endsWith(".tsx") ? "tsx" : "ts");

export const bundleClientPlugin = (
	sources: ClientPluginSources,
	compilerRoot: string,
	instrumentation?: ClientCompilerBenchmarkInstrumentation,
) =>
	Effect.suspend(() => {
		const assets = new Set<string>();
		const stylesheets = new Set<string>();
		const publicExports = new Set<string>();
		const loadedSources = new Set<string>();
		const rejected: ClientPluginCompilerDiagnostic[] = [];
		let stylexTracer: ReturnType<typeof createStylexTracerBundleAdapter> | undefined;
		if (sources.stylexTracer !== undefined) {
			try {
				const finishMaterialization = instrumentation?.start("trusted-reads-materialization", true);
				stylexTracer = createStylexTracerBundleAdapter(
					sources.files,
					compilerRoot,
					undefined,
					instrumentation,
				);
				finishMaterialization?.();
				if (stylexTracer.preflightDiagnostics.length > 0) {
					const finishCleanup = instrumentation?.start("cleanup", true);
					stylexTracer.cleanup();
					finishCleanup?.();
					return Effect.fail(clientPluginCompilationFailure(stylexTracer.preflightDiagnostics));
				}
			} catch (error) {
				return Effect.fail(
					clientPluginCompilationFailure([
						clientPluginCompilerDiagnostic(
							"RYOT_CLIENT_STYLEX",
							sources.entry,
							`StyleX tracer dependencies could not be resolved: ${String(error)}`,
						),
					]),
				);
			}
		}

		const plugin: Bun.BunPlugin = {
			name: "ryot-client-plugin-source",
			setup(builder) {
				builder.onResolve({ filter: /^ryot:client-entry$/ }, () => ({
					path: sources.entry,
					namespace: CLIENT_NAMESPACE,
				}));
				builder.onResolve({ filter: /^\.{1,2}\// }, ({ path, importer }) => {
					const trustedImporter = stylexTracer?.trustedSources[importer];
					if (trustedImporter !== undefined && stylexTracer !== undefined) {
						const resolved = stylexTracer.resolveTrustedImport(importer, path);
						if (resolved !== undefined) {
							return { path: resolved, namespace: STYLEX_TRUSTED_NAMESPACE };
						}
						rejected.push(
							clientPluginCompilerDiagnostic(
								"RYOT_CLIENT_IMPORT",
								trustedImporter.logicalPath,
								`Trusted StyleX tracer import "${path}" is outside the approved tracer sources`,
							),
						);
						return { path, namespace: UNTRUSTED_NAMESPACE };
					}
					if (!Object.hasOwn(sources.files, importer)) {
						return undefined;
					}
					const issue = clientImportPolicyIssue(sources, importer, path);
					const resolved = resolveClientLocalImport(sources, importer, path);
					if (issue !== null || resolved === null) {
						rejected.push(
							clientPluginCompilerDiagnostic(
								"RYOT_CLIENT_IMPORT",
								importer,
								issue ?? `Import "${path}" could not be resolved inside the plugin client sources`,
							),
						);
						return { path, namespace: UNTRUSTED_NAMESPACE };
					}
					return { path: resolved, namespace: CLIENT_NAMESPACE };
				});
				builder.onResolve({ filter: /^@ryot-app\/plugins\// }, ({ path, importer }) => {
					if (!Object.hasOwn(sources.files, importer)) {
						return undefined;
					}
					const issue = clientImportPolicyIssue(sources, importer, path);
					if (issue !== null) {
						rejected.push(clientPluginCompilerDiagnostic("RYOT_CLIENT_IMPORT", importer, issue));
						return { path, namespace: UNTRUSTED_NAMESPACE };
					}
					const resolved = sources.publicExports[path];
					if (resolved === undefined) {
						return { path, external: true };
					}
					publicExports.add(path);
					return { path: resolved, namespace: CLIENT_NAMESPACE };
				});
				builder.onResolve({ filter: /^[^.]/ }, ({ path, importer }) => {
					const trustedImporter = stylexTracer?.trustedSources[importer];
					if (trustedImporter !== undefined && stylexTracer !== undefined) {
						if (STYLEX_TRACER_TRUSTED_MODULES.some((trusted) => trusted === path)) {
							const trustedPath = stylexTracer.trustedEntries[path];
							return trustedPath === undefined
								? { path, namespace: UNTRUSTED_NAMESPACE }
								: { path: trustedPath, namespace: STYLEX_TRUSTED_NAMESPACE };
						}
						if (
							path === STYLEX_RUNTIME_MODULE ||
							path === "@tanstack/react-hotkeys" ||
							isTrustedClientModule(path)
						) {
							return { namespace: "file", path: Bun.resolveSync(path, compilerRoot) };
						}
						rejected.push(
							clientPluginCompilerDiagnostic(
								"RYOT_CLIENT_IMPORT",
								trustedImporter.logicalPath,
								`Trusted StyleX tracer import "${path}" is not approved`,
							),
						);
						return { path, namespace: UNTRUSTED_NAMESPACE };
					}
					if (!Object.hasOwn(sources.files, importer)) {
						return undefined;
					}
					const issue = clientImportPolicyIssue(sources, importer, path);
					if (issue !== null) {
						rejected.push(clientPluginCompilerDiagnostic("RYOT_CLIENT_IMPORT", importer, issue));
						return { path, namespace: UNTRUSTED_NAMESPACE };
					}
					if (STYLEX_TRACER_TRUSTED_MODULES.some((trusted) => trusted === path)) {
						const trustedPath = stylexTracer?.trustedEntries[path];
						return trustedPath === undefined
							? { path, namespace: UNTRUSTED_NAMESPACE }
							: { path: trustedPath, namespace: STYLEX_TRUSTED_NAMESPACE };
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
					({ path }) => ({ namespace: "file", path: Bun.resolveSync(path, compilerRoot) }),
				);
				builder.onResolve({ filter: /^@tanstack\/react-store$/ }, ({ path, importer }) => ({
					namespace: "file",
					path: Bun.resolveSync(path, importer.slice(0, importer.lastIndexOf("/"))),
				}));
				builder.onResolve(
					{ filter: /^@tanstack\/(?:react-table|table-core(?:\/.*)?)$/ },
					({ path, importer }) => ({
						namespace: "file",
						path: Bun.resolveSync(path, importer.slice(0, importer.lastIndexOf("/"))),
					}),
				);
				// Bun drops namespace bindings when bundling these exports from the Effect barrel.
				builder.onResolve({ filter: /^effect$/ }, () => ({
					path: "effect",
					namespace: EFFECT_NAMESPACE,
				}));
				builder.onResolve(
					{ filter: /^effect\/(?:DateTime|Match|Option|Result|Schema|SchemaGetter)$/ },
					({ path }) => ({ namespace: "file", path: Bun.resolveSync(path, compilerRoot) }),
				);
				builder.onLoad({ filter: /.*/, namespace: EFFECT_NAMESPACE }, () => ({
					loader: "js" as const,
					contents: `
export * as DateTime from "effect/DateTime";
export * as Match from "effect/Match";
export * as Option from "effect/Option";
export * as Result from "effect/Result";
export * as Schema from "effect/Schema";
export * as SchemaGetter from "effect/SchemaGetter";
`,
				}));
				builder.onLoad({ filter: /.*/, namespace: UNTRUSTED_NAMESPACE }, () => ({
					contents: "",
					loader: "js" as const,
				}));
				builder.onLoad({ filter: /.*/, namespace: STYLEX_TRUSTED_NAMESPACE }, ({ path }) => {
					const trusted = stylexTracer?.trustedSources[path];
					if (trusted === undefined || stylexTracer === undefined) {
						rejected.push(
							clientPluginCompilerDiagnostic(
								"RYOT_CLIENT_IMPORT",
								sources.entry,
								`Trusted StyleX tracer source "${path}" is not approved`,
							),
						);
						return { contents: "", loader: "js" as const };
					}
					const transformed = stylexTracer.transform(
						trusted.logicalPath,
						trusted.source,
						trusted.actualPath,
					);
					if (transformed.diagnostic !== undefined) {
						rejected.push(transformed.diagnostic);
					}
					return { loader: sourceLoader(path), contents: transformed.code ?? "" };
				});
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
						loadedSources.add(path);
						stylesheets.add(path);
						return { contents: "", loader: "js" as const };
					}
					loadedSources.add(path);
					if (stylexTracer !== undefined && /\.tsx?$/.test(path) && !isSharedClientSource(path)) {
						const actualPath = stylexTracer.archivedPaths[path];
						if (actualPath === undefined) {
							rejected.push(
								clientPluginCompilerDiagnostic(
									"RYOT_CLIENT_STYLEX",
									path,
									`StyleX source "${path}" has no canonical compiler path`,
								),
							);
							return { contents: "", loader: "js" as const };
						}
						const transformed = stylexTracer.transform(path, source, actualPath);
						if (transformed.diagnostic !== undefined) {
							rejected.push(transformed.diagnostic);
						}
						return { loader: sourceLoader(path), contents: transformed.code ?? "" };
					}
					return { contents: source, loader: sourceLoader(path) };
				});
			},
		};

		return Effect.tryPromise({
			catch: (error) =>
				clientPluginCompilationFailure([
					clientPluginCompilerDiagnostic(
						"RYOT_CLIENT_BUNDLE",
						sources.entry,
						`Client plugin bundling failed: ${String(error)}`,
					),
				]),
			try: async () => {
				try {
					return await Bun.build({
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
					});
				} finally {
					if (stylexTracer !== undefined) {
						const finishCleanup = instrumentation?.start("cleanup", true);
						stylexTracer.cleanup();
						finishCleanup?.();
					}
				}
			},
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
					Effect.map((javascript) =>
						Object.assign(
							{
								javascript,
								assets: sortBy([...assets]),
								sources: sortBy([...loadedSources]),
								stylesheets: sortBy([...stylesheets]),
								publicExports: sortBy([...publicExports]),
							},
							stylexTracer === undefined ? {} : { stylexRules: [...stylexTracer.rules] },
						),
					),
				);
			}),
		);
	});
