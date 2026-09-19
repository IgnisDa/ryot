import { compileClientPluginModule } from "@ryot-app/client-plugin-compiler";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { PluginArchivePackage } from "@ryot-app/plugin-archive";
import { compilePluginManifestScripts } from "@ryot-app/sandbox-compiler/plugin-manifest";
import { Effect } from "effect";

export type PluginPackageInput = Pick<PluginArchivePackage, "files" | "manifest"> &
	Partial<Pick<PluginArchivePackage, "compiledClient" | "compiledScripts">>;

const decoder = new TextDecoder("utf-8", { fatal: true });

const sandboxSources = (files: PluginArchivePackage["files"]) =>
	Object.fromEntries(
		Object.entries(files)
			.filter(([path]) => path.startsWith("backend/") || path.startsWith("shared/"))
			.map(([path, contents]) => [path, decoder.decode(contents)]),
	);

const clientSources = (files: PluginArchivePackage["files"]) =>
	Object.fromEntries(
		Object.entries(files).filter(
			([path]) => path.startsWith("client/") || path.startsWith("shared/"),
		),
	);

const compileClient = (manifest: PluginManifest, files: PluginArchivePackage["files"]) => {
	const client = manifest.client;
	if (!client) {
		return Effect.void;
	}
	return compileClientPluginModule({
		files: clientSources(files),
		name: manifest.metadata.name,
		apiVersion: client.apiVersion,
		pluginDependencies: client.pluginDependencies ?? [],
		publicExports: Object.fromEntries(
			Object.entries(client.exports ?? {}).map(([name, declaration]) => [
				name,
				{ kind: declaration.kind, entry: declaration.entry },
			]),
		),
	}).pipe(Effect.map(({ artifact }) => artifact));
};

export const compilePluginPackage = (input: PluginPackageInput) =>
	Effect.gen(function* () {
		const compiledScripts =
			input.compiledScripts ??
			(yield* compilePluginManifestScripts(input.manifest, sandboxSources(input.files))).map(
				({ script, source, compiled }) => ({
					source,
					entry: script.entry,
					format: compiled.format,
					javascript: compiled.javascript,
				}),
			);
		const compiledClient =
			input.compiledClient ?? (yield* compileClient(input.manifest, input.files));
		return {
			compiledScripts,
			files: input.files,
			manifest: input.manifest,
			...(compiledClient ? { compiledClient } : {}),
		} satisfies PluginArchivePackage;
	});
