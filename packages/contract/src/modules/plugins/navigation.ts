import type { PluginId } from "../../schema/brands";
import type { SavedViewReference } from "./references";

export const pluginPath = (pluginId: PluginId | string, path = "/") => {
	const normalizedPath = path.startsWith("/") ? path : `/${path}`;
	return `/p/${encodeURIComponent(pluginId)}${path === "/" ? "" : normalizedPath}`;
};

export function savedViewPath(reference: SavedViewReference): string {
	switch (reference.kind) {
		case "custom":
			return `/v/c/${encodeURIComponent(reference.savedViewId)}`;
		case "kernel":
			return `/v/k/${encodeURIComponent(reference.slug)}`;
		case "plugin":
			return `/v/p/${encodeURIComponent(reference.pluginId)}/${encodeURIComponent(reference.slug)}`;
		default:
			throw new Error(`Unknown saved view reference: ${String(reference satisfies never)}`);
	}
}
