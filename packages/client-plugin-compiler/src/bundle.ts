import { resolve } from "node:path";

import { buildWithVite, type CompilerWorkspace } from "@ryot-app/vite-compiler";
import tailwindcss from "@tailwindcss/vite";
import { Effect } from "effect";

import {
	type ClientPluginCompilerDiagnostic,
	clientPluginCompilationFailure,
	clientPluginCompilerDiagnostic,
} from "./diagnostics";
import { clientTypeScriptProject } from "./semantic-check";

const toDiagnostic = (
	diagnostic: {
		readonly code?: string;
		readonly file?: string;
		readonly location?: { readonly line: number; readonly column: number };
		readonly message: string;
		readonly severity: "error" | "info" | "warning";
	},
	entry: string,
): ClientPluginCompilerDiagnostic => ({
	message: diagnostic.message,
	severity: diagnostic.severity,
	code: diagnostic.code ?? "RYOT_CLIENT_BUNDLE",
	line: Math.max(1, diagnostic.location?.line ?? 1),
	column: Math.max(1, diagnostic.location?.column ?? 1),
	file: diagnostic.file?.replace(/^source\//, "") ?? entry,
});

export const bundleClientPlugin = ({
	entry,
	workspace,
	publicExports,
	unresolvedPluginDependencies = [],
}: {
	readonly entry: string;
	readonly workspace: CompilerWorkspace;
	readonly publicExports: Readonly<Record<string, string>>;
	readonly unresolvedPluginDependencies?: readonly string[];
}) =>
	buildWithVite({
		workspace,
		root: workspace.generatedPath,
		typeScriptProject: clientTypeScriptProject,
		config: {
			base: "./",
			mode: "production",
			plugins: tailwindcss(),
			oxc: { jsx: { development: false } },
			envPrefix: "__RYOT_CLIENT_PLUGIN_NO_ENV__",
			define: { "import.meta.env": "{}", "process.env.NODE_ENV": JSON.stringify("production") },
			resolve: {
				alias: Object.entries(publicExports).map(([find, path]) => ({
					find,
					replacement: resolve(workspace.sourcePath, path),
				})),
			},
			build: {
				minify: true,
				target: "es2022",
				cssCodeSplit: false,
				assetsInlineLimit: 0,
				modulePreload: false,
				rolldownOptions: {
					input: { index: resolve(workspace.generatedPath, "index.html") },
					external: unresolvedPluginDependencies.map(
						(slug) =>
							new RegExp(`^@ryot-app/plugins/${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`),
					),
					output: {
						entryFileNames: "plugin.js",
						chunkFileNames: "chunk-[hash].js",
						assetFileNames: ({ names }) =>
							(names[0] ?? "").endsWith(".css") ? "plugin.css" : "asset-[hash][extname]",
					},
				},
			},
		},
	}).pipe(
		Effect.mapError((error) =>
			clientPluginCompilationFailure(
				(error.diagnostics?.length ?? 0) > 0
					? (error.diagnostics ?? []).map((diagnostic) => toDiagnostic(diagnostic, entry))
					: [
							clientPluginCompilerDiagnostic(
								"RYOT_CLIENT_BUNDLE",
								entry,
								`Client plugin Vite build failed: ${error.message}`,
							),
						],
			),
		),
		Effect.map(({ files, diagnostics }) => ({
			files,
			diagnostics: diagnostics.map((diagnostic) => toDiagnostic(diagnostic, entry)),
		})),
	);
