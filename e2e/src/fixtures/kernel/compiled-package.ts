import { type PluginManifest, PluginScript } from "@ryot-app/contract/modules/plugins/manifest";
import { manifestCatalogs } from "@ryot-app/contract/testing";
import type { PluginArchiveCatalogs, PluginArchivePackage } from "@ryot-app/plugin-archive";
import {
	compilePluginManifestScripts,
	derivePluginSandboxScripts,
} from "@ryot-app/plugin-backend-compiler/plugin-manifest";
import {
	compileClientPluginModule,
	type PluginClientCompilerPackageInput,
} from "@ryot-app/plugin-client-compiler";
import { clientDeclarationHash } from "@ryot-app/plugin-client-contract";
import { Effect, Schema } from "effect";

import { manifestEnglish } from "./manifest-text";

export type PluginPackageInput = Pick<PluginArchivePackage, "manifest"> &
	Pick<PluginClientCompilerPackageInput, "files"> &
	Partial<Pick<PluginArchivePackage, "catalogs" | "compiledClient" | "compiledScripts">>;

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

const compileClient = (
	manifest: PluginManifest,
	files: PluginPackageInput["files"],
	catalog: PluginArchiveCatalogs[string],
) => {
	const client = manifest.client;
	if (!client) {
		return Effect.void;
	}
	return compileClientPluginModule({
		catalog,
		kind: "plugin",
		files: clientSources(files),
		apiVersion: client.apiVersion,
		packageId: manifest.metadata.packageId,
		pluginDependencies: manifest.dependencies ?? {},
		clientDeclarationHash: clientDeclarationHash(client),
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
		const catalogs = input.catalogs ?? manifestCatalogs(input.manifest, manifestEnglish);
		const catalog = catalogs.en;
		const derived = input.compiledScripts
			? undefined
			: yield* derivePluginSandboxScripts(sandboxSources(input.files), catalog);
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
			(yield* compilePluginManifestScripts(manifest, sandboxSources(input.files), catalog)).map(
				({ script, compiled }) => ({
					entry: script.entry,
					format: compiled.format,
					javascript: compiled.javascript,
				}),
			);
		const compiledClient =
			input.compiledClient ?? (yield* compileClient(manifest, input.files, catalog));
		return {
			manifest,
			catalogs,
			compiledScripts,
			...(compiledClient ? { compiledClient } : {}),
		} satisfies PluginArchivePackage;
	});
