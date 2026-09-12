import {
	clientArtifactMetadata,
	type PluginClientArtifact,
} from "@ryot-app/client-plugin-contract";
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

export const loadPluginSource = (packageRoot: string, manifest: unknown) =>
	Effect.gen(function* () {
		const outputs = yield* loadPluginSandboxScripts(packageRoot);
		const declaredScripts =
			typeof manifest === "object" && manifest !== null && "scripts" in manifest
				? manifest.scripts
				: undefined;
		const byEntry = new Map(outputs.map(({ script, compiled }) => [script.entry, compiled]));
		const compiledScripts = Array.isArray(declaredScripts)
			? declaredScripts.flatMap((value) => {
					if (typeof value !== "object" || value === null || !("entry" in value)) {
						return [];
					}
					const entry = value.entry;
					const compiled = typeof entry === "string" ? byEntry.get(entry) : undefined;
					return compiled && typeof entry === "string"
						? [{ entry, format: compiled.format, javascript: compiled.javascript }]
						: [];
				})
			: [];
		const clientManifest =
			typeof manifest === "object" && manifest !== null && "client" in manifest
				? manifest.client
				: undefined;
		let compiledClient: PluginClientArtifact | undefined;
		if (clientManifest) {
			const metadataValue =
				typeof manifest === "object" && manifest !== null && "metadata" in manifest
					? manifest.metadata
					: undefined;
			const pluginName =
				typeof metadataValue === "object" &&
				metadataValue !== null &&
				"name" in metadataValue &&
				typeof metadataValue.name === "string"
					? metadataValue.name
					: "Fixture";
			compiledClient = fixtureClientArtifact(pluginName);
		}
		return {
			manifest,
			compiledScripts,
			...(compiledClient ? { compiledClient } : {}),
		} satisfies PluginSource;
	});
