import { renderConfigReference } from "@ryot/config";
import { PluginManifest } from "@ryot/contract/modules/plugins/manifest";
import { appConfigDefinition } from "@ryot/kernel-backend/lib/infrastructure/config/definition";
import { Schema } from "effect";

const manifestPaths = [
	"../../../plugins/fitness/dist/bundle/manifest.json",
	"../../../plugins/media/dist/bundle/manifest.json",
];

const manifests = await Promise.all(
	manifestPaths.map(async (manifestPath) =>
		Schema.decodeUnknownSync(PluginManifest)(
			await Bun.file(new URL(manifestPath, import.meta.url)).json(),
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
