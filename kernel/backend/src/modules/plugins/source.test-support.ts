import {
	clientArtifactMetadata,
	type PluginClientArtifact,
} from "@ryot-app/client-plugin-contract";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { derivePluginSandboxScripts } from "@ryot-app/sandbox-compiler/plugin-manifest";
import { Data, Effect, FileSystem, Stream } from "effect";

import type { PluginSource } from "./types";

export class PluginSourceError extends Data.TaggedError("PluginSourceError")<{
	readonly message: string;
}> {}

export const fixtureClientArtifact = (pluginName: string): PluginClientArtifact => {
	const files = [
		{
			name: "index.html",
			contentType: "text/html; charset=utf-8",
			contents: new TextEncoder().encode("<!doctype html><html></html>"),
		},
		{
			name: "plugin.js",
			contentType: "text/javascript; charset=utf-8",
			contents: new TextEncoder().encode("export {};"),
		},
	];
	return { ...clientArtifactMetadata(pluginName, files), files };
};

const pluginSourcePaths = (packageRoot: string) =>
	Stream.fromAsyncIterable(
		new Bun.Glob("**/*.ts").scan({ onlyFiles: true, cwd: packageRoot, followSymlinks: false }),
		(error) => new PluginSourceError({ message: String(error) }),
	).pipe(
		Stream.filter((path) => !path.endsWith(".test.ts")),
		Stream.runCollect,
	);

export const loadPluginSandboxScripts = Effect.fn("loadPluginSandboxScripts")(function* (
	packageRoot: string,
) {
	const fs = yield* FileSystem.FileSystem;
	const paths = yield* pluginSourcePaths(packageRoot);
	const entries = yield* Effect.forEach(paths, (path) =>
		fs.readFile(`${packageRoot}/${path}`).pipe(
			Effect.mapError((error) => new PluginSourceError({ message: String(error) })),
			Effect.map((contents) => [path, contents] as const),
		),
	);
	const files = Object.fromEntries(entries);
	return yield* derivePluginSandboxScripts(
		Object.fromEntries(
			Object.entries(files)
				.filter(([path]) => path.startsWith("backend/") || path.startsWith("shared/"))
				.map(([path, contents]) => [
					path,
					new TextDecoder("utf-8", { fatal: true }).decode(contents),
				]),
		),
	);
});

export const loadPluginSource = (packageRoot: string, manifest: PluginManifest) =>
	Effect.gen(function* () {
		const outputs = yield* loadPluginSandboxScripts(packageRoot);
		const byEntry = new Map(outputs.map((output) => [output.script.entry, output]));
		const compiledScripts = manifest.scripts.flatMap(({ entry }) => {
			const output = byEntry.get(entry);
			return output
				? [{ entry, format: output.compiled.format, javascript: output.compiled.javascript }]
				: [];
		});
		const scripts = manifest.scripts.map((script) => {
			const output = byEntry.get(script.entry);
			return output ? { ...script, runtimeImports: output.script.runtimeImports } : script;
		});
		return {
			compiledScripts,
			manifest: { ...manifest, scripts },
			...(manifest.client ? { compiledClient: fixtureClientArtifact(manifest.metadata.name) } : {}),
		} satisfies PluginSource;
	});
