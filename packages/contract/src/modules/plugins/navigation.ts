import { pluginPackageSegments, type PluginPackageId } from "../../schema/brands";
import type { SavedViewReference } from "./references";

type SavedViewPathReference =
	| Exclude<SavedViewReference, { readonly kind: "plugin" }>
	| { readonly kind: "plugin"; readonly packageId: PluginPackageId; readonly slug: string };

const packagePath = (packageId: PluginPackageId) => {
	const { name, publisher } = pluginPackageSegments(packageId);
	return `${encodeURIComponent(publisher)}/${encodeURIComponent(name)}`;
};

export const pluginPath = (packageId: PluginPackageId, path = "/") => {
	const normalizedPath = path.startsWith("/") ? path : `/${path}`;
	return `/p/${packagePath(packageId)}${path === "/" ? "" : normalizedPath}`;
};

export function savedViewPath(reference: SavedViewPathReference): string {
	switch (reference.kind) {
		case "custom":
			return `/v/c/${encodeURIComponent(reference.savedViewId)}`;
		case "kernel":
			return `/v/k/${encodeURIComponent(reference.slug)}`;
		case "plugin":
			return `/v/p/${packagePath(reference.packageId)}/${encodeURIComponent(reference.slug)}`;
		default:
			throw new Error(`Unknown saved view reference: ${String(reference satisfies never)}`);
	}
}
