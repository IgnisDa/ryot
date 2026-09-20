import { pluginPackageSegments, type PluginPackageId } from "../../schema/brands";

const normalizeEnvironmentSegment = (value: string) =>
	value
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.replace(/[^a-zA-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.toUpperCase();

const packageEnvironmentSegment = (segment: string) => segment.replaceAll("-", "_").toUpperCase();

export const pluginConfigEnvironmentKey = (packageId: PluginPackageId, key: string) => {
	const { name, publisher } = pluginPackageSegments(packageId);
	return `RYOT_PLUGIN__${packageEnvironmentSegment(publisher)}__${packageEnvironmentSegment(name)}__${normalizeEnvironmentSegment(key)}`;
};
