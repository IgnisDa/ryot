import { renderConfigReference } from "@ryot/config";
import { appConfigDefinition } from "@ryot/kernel-backend/lib/infrastructure/config/definition";
import { readPluginArchive } from "@ryot/plugin-archive";
import { Effect } from "effect";

const slugs: ReadonlyArray<string> = await Bun.file(
	new URL("../../server/shipped-plugins.json", import.meta.url),
).json();

const manifests = await Promise.all(
	slugs.map(async (slug) => {
		const archive = await Bun.file(
			new URL(`../../../plugins/${slug}/dist/${slug}.zip`, import.meta.url),
		).bytes();
		const pluginPackage = await Effect.runPromise(readPluginArchive(archive));
		return pluginPackage.manifest;
	}),
);

const plugins = manifests.map((manifest) => ({
	name: manifest.metadata.name,
	slug: manifest.metadata.slug,
	schema: manifest.configSchema,
}));

await Bun.write(
	new URL("../src/includes/app-backend-config-schema.md", import.meta.url),
	renderConfigReference(appConfigDefinition, plugins),
);
