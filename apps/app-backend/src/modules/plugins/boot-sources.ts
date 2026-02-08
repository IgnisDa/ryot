import fitnessPlugin from "@ryot/plugin-fitness";
import mediaPlugin from "@ryot/plugin-media";

const packageRoot = (name: "fitness" | "media") =>
	new URL(`../../../../../plugins/${name}/`, import.meta.url).pathname;

export const bootPluginSources = [
	{ manifest: mediaPlugin, packageRoot: packageRoot("media") },
	{ manifest: fitnessPlugin, packageRoot: packageRoot("fitness") },
] as const;

export const bootConfiguredPluginSlugs: ReadonlySet<string> = new Set(
	bootPluginSources.map(({ manifest }) => manifest.metadata.slug),
);
