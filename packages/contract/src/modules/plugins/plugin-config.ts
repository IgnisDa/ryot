import type { PluginPackageId } from "../../schema/brands";

const normalizeEnvironmentSegment = (value: string) =>
	value
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.replace(/[^a-zA-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.toUpperCase();

export const pluginConfigEnvironmentKey = (packageId: PluginPackageId, key: string) =>
	`RYOT_PLUGIN_${packageId.replaceAll("-", "").toUpperCase()}_${normalizeEnvironmentSegment(key)}`;
