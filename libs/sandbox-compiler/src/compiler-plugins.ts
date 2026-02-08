import { Effect } from "effect";

import {
	compileSandboxPackageEntries,
	type CompiledBuiltInSandboxEntry,
} from "./compiler-builtins";
import { sandboxCompilationFailure, sandboxCompilerDiagnostic } from "./compiler-diagnostics";

export type PluginSandboxScriptEntry = { readonly entry: string };

export type CompiledPluginSandboxEntry = CompiledBuiltInSandboxEntry;

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
		const entries = scripts.map(({ entry }) => entry).sort();
		if (new Set(entries).size !== entries.length) {
			return yield* sandboxCompilationFailure([
				sandboxCompilerDiagnostic("RYOT_PLUGIN_ENTRY", "Plugin script entries must be unique"),
			]);
		}
		const files = yield* loadPluginSources(packageRoot);
		return yield* compileSandboxPackageEntries({ entry: entries[0] ?? "", files }, entries);
	});
