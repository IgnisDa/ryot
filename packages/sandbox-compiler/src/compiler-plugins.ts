import { Effect, FileSystem } from "effect";

import { compileSandboxPackageEntries, type SandboxEntryDeclaration } from "./compiler-builtins";
import { sandboxCompilationFailure, sandboxCompilerDiagnostic } from "./compiler-diagnostics";
import type { SandboxTypeScriptSources } from "./compiler-project";

export type PluginSandboxScriptEntry = SandboxEntryDeclaration & {
	readonly entry: string;
};

const sortedEntries = (scripts: ReadonlyArray<PluginSandboxScriptEntry>) =>
	scripts.map(({ entry }) => entry).sort();

export const compilePluginSandboxSourceEntries = (
	files: SandboxTypeScriptSources["files"],
	scripts: ReadonlyArray<PluginSandboxScriptEntry>,
) => {
	const entries = sortedEntries(scripts);
	if (new Set(entries).size !== entries.length) {
		return sandboxCompilationFailure([
			sandboxCompilerDiagnostic("RYOT_PLUGIN_ENTRY", "Plugin script entries must be unique"),
		]);
	}
	return compileSandboxPackageEntries(
		{ entry: entries[0] ?? "", files },
		entries,
		new Map(
			scripts.map(
				({ entry, kind, providerOperation }) =>
					[entry, providerOperation ? { kind, providerOperation } : { kind }] as const,
			),
		),
	);
};

const loadPluginSources = (packageRoot: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const paths = yield* fs
			.glob("**/*.ts", { root: packageRoot, exclude: ["node_modules/**"] })
			.pipe(
				Effect.mapError((error) =>
					sandboxCompilationFailure([
						sandboxCompilerDiagnostic(
							"RYOT_PLUGIN_SOURCE",
							`Plugin sources could not be read: ${String(error)}`,
						),
					]),
				),
			);
		const files: Record<string, string> = {};
		for (const path of paths) {
			if (!path.endsWith(".test.ts")) {
				files[path] = yield* Effect.tryPromise({
					try: () => Bun.file(`${packageRoot}/${path}`).text(),
					catch: (error) =>
						sandboxCompilationFailure([
							sandboxCompilerDiagnostic(
								"RYOT_PLUGIN_SOURCE",
								`Plugin sources could not be read: ${String(error)}`,
							),
						]),
				});
			}
		}
		return files;
	});

export const compilePluginSandboxEntries = (
	packageRoot: string,
	scripts: ReadonlyArray<PluginSandboxScriptEntry>,
) =>
	Effect.gen(function* () {
		const files = yield* loadPluginSources(packageRoot);
		return yield* compilePluginSandboxSourceEntries(files, scripts);
	});
