import { pluginPackageSegments, type PluginPackageId } from "../../schema/brands";

const normalizeEnvironmentSegment = (value: string) =>
	value
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.replace(/[^a-zA-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.toUpperCase();

export const pluginConfigEnvironmentKey = (packageId: PluginPackageId, key: string) => {
	const { name, publisher } = pluginPackageSegments(packageId);
	return `RYOT_PLUGIN__${normalizeEnvironmentSegment(publisher)}__${normalizeEnvironmentSegment(name)}__${normalizeEnvironmentSegment(key)}`;
};
