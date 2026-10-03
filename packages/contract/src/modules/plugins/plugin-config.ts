const normalizeEnvironmentSegment = (value: string) =>
	value
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.replace(/[^a-zA-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.toUpperCase();

export const pluginConfigEnvironmentKey = (pluginSlug: string, key: string) =>
	`RYOT_PLUGIN_${normalizeEnvironmentSegment(pluginSlug)}_${normalizeEnvironmentSegment(key)}`;
