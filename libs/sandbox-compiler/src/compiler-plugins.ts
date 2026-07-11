import { Effect } from "effect";

import { compileSandboxPackageEntries } from "./compiler-builtins";
import { sandboxCompilationFailure, sandboxCompilerDiagnostic } from "./compiler-diagnostics";
import type { SandboxTypeScriptSources } from "./compiler-project";

export type PluginSandboxScriptEntry = { readonly entry: string };

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
	return compileSandboxPackageEntries({ entry: entries[0] ?? "", files }, entries);
};

const loadPluginSources = (packageRoot: string) =>
	Effect.tryPromise({
		try: async () => {
			const files: Record<string, string> = {};
			const glob = new Bun.Glob("**/*.ts");
			for await (const path of glob.scan({ cwd: packageRoot, onlyFiles: true })) {
				if (!path.endsWith(".test.ts")) {
					files[path] = await Bun.file(`${packageRoot}/${path}`).text();
				}
			}
			return files;
		},
		catch: (error) =>
			sandboxCompilationFailure([
				sandboxCompilerDiagnostic(
					"RYOT_PLUGIN_SOURCE",
					`Plugin sources could not be read: ${String(error)}`,
				),
			]),
	});

export const compilePluginSandboxEntries = (
	packageRoot: string,
	scripts: ReadonlyArray<PluginSandboxScriptEntry>,
) =>
	Effect.gen(function* () {
		const files = yield* loadPluginSources(packageRoot);
		return yield* compilePluginSandboxSourceEntries(files, scripts);
	});
