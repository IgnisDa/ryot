import {
	clientArtifactMetadata,
	type PluginClientArtifact,
} from "@ryot-app/client-plugin-contract";
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

export const loadPluginSource = (packageRoot: string, manifest: unknown) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const paths = yield* pluginSourcePaths(packageRoot);
		const entries = yield* Effect.forEach(paths, (path) =>
			fs.readFile(`${packageRoot}/${path}`).pipe(
				Effect.mapError((error) => new PluginSourceError({ message: String(error) })),
				Effect.map((contents) => [path, contents] as const),
			),
		);
		const files = Object.fromEntries(entries);
		const declaredScripts =
			typeof manifest === "object" && manifest !== null && "scripts" in manifest
				? manifest.scripts
				: undefined;
		const compiledScripts = Array.isArray(declaredScripts)
			? declaredScripts.flatMap((value) => {
					if (typeof value !== "object" || value === null || !("entry" in value)) {
						return [];
					}
					const entry = value.entry;
					const contents = files[String(entry)];
					return typeof entry === "string" && contents
						? [
								{
									entry,
									format: 1,
									javascript: "export {};",
									source: new TextDecoder("utf-8", { fatal: true }).decode(contents),
								},
							]
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
			files,
			manifest,
			compiledScripts,
			...(compiledClient ? { compiledClient } : {}),
		} satisfies PluginSource;
	});
