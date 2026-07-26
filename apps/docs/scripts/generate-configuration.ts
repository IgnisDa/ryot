import { renderConfigReference } from "@ryot/config";
import { PluginManifest } from "@ryot/contract/modules/plugins/manifest";
import { appConfigDefinition } from "@ryot/kernel-backend/lib/infrastructure/config/definition";
import { Schema } from "effect";

const slugs: ReadonlyArray<string> = await Bun.file(
	new URL("../../server/shipped-plugins.json", import.meta.url),
).json();

const manifests = await Promise.all(
	slugs.map(async (slug) =>
		Schema.decodeUnknownSync(PluginManifest)(
			await Bun.file(
				new URL(`../../../plugins/${slug}/dist/bundle/manifest.json`, import.meta.url),
			).json(),
		),
	),
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
