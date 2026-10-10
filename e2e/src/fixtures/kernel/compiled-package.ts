import {
	compileClientPluginModule,
	type ClientPluginCompilerPackageInput,
} from "@ryot-app/client-plugin-compiler";
import { PluginScript, type PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { PluginArchivePackage } from "@ryot-app/plugin-archive";
import {
	compilePluginManifestScripts,
	derivePluginSandboxScripts,
} from "@ryot-app/sandbox-compiler/plugin-manifest";
import { Effect, Schema } from "effect";

export type PluginPackageInput = Pick<PluginArchivePackage, "manifest"> &
	Pick<ClientPluginCompilerPackageInput, "files"> &
	Partial<Pick<PluginArchivePackage, "compiledClient" | "compiledScripts">>;

const decoder = new TextDecoder("utf-8", { fatal: true });

const sandboxSources = (files: PluginPackageInput["files"]) =>
	Object.fromEntries(
		Object.entries(files)
			.filter(([path]) => path.startsWith("backend/") || path.startsWith("shared/"))
			.map(([path, contents]) => [path, decoder.decode(contents)]),
	);

const clientSources = (files: PluginPackageInput["files"]) =>
	Object.fromEntries(
		Object.entries(files).filter(
			([path]) => path.startsWith("client/") || path.startsWith("shared/"),
		),
	);

const compileClient = (manifest: PluginManifest, files: PluginPackageInput["files"]) => {
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
		const derived = input.compiledScripts
			? undefined
			: yield* derivePluginSandboxScripts(sandboxSources(input.files));
		const byEntry = new Map(derived?.map(({ script }) => [script.entry, script]));
		const manifest = {
			...input.manifest,
			scripts: yield* Effect.forEach(input.manifest.scripts, (script) => {
				const generated = byEntry.get(script.entry);
				return generated
					? Schema.decodeUnknownEffect(PluginScript)({
							...script,
							capabilities: generated.capabilities,
							runtimeImports: generated.runtimeImports,
							oauthConnectionFields: generated.oauthConnectionFields,
							executableDependencies: generated.executableDependencies,
							requiredPluginConfigKeys: generated.requiredPluginConfigKeys,
							optionalPluginConfigKeys: generated.optionalPluginConfigKeys,
						})
					: Effect.succeed(script);
			}),
		};
		const compiledScripts =
			input.compiledScripts ??
			(yield* compilePluginManifestScripts(manifest, sandboxSources(input.files))).map(
				({ script, compiled }) => ({
					entry: script.entry,
					format: compiled.format,
					javascript: compiled.javascript,
				}),
			);
		const compiledClient = input.compiledClient ?? (yield* compileClient(manifest, input.files));
		return {
			manifest,
			compiledScripts,
			...(compiledClient ? { compiledClient } : {}),
		} satisfies PluginArchivePackage;
	});
