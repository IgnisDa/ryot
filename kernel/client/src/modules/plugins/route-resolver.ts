import { reservedPluginSlugs } from "@ryot/contract/modules/plugins/schemas";
import type {
	PluginClientCatalog,
	PluginClientCatalogEntry,
} from "@ryot/ryotql-recipes/plugin-client-catalog";

export type RouteTarget =
	| { readonly owner: "kernel"; readonly surface: { readonly kind: "not-found" } }
	| {
			readonly owner: "plugin";
			readonly surface: { readonly kind: "home" };
			readonly installation: PluginClientCatalogEntry;
	  };

const notFound: RouteTarget = { owner: "kernel", surface: { kind: "not-found" } };

export function resolveRouteTarget(catalog: PluginClientCatalog, pluginSlug: string): RouteTarget {
	if (reservedPluginSlugs.has(pluginSlug)) {
		return notFound;
	}
	const installation = catalog.find((candidate) => candidate.slug === pluginSlug);
	return installation === undefined
		? notFound
		: { installation, owner: "plugin", surface: { kind: "home" } };
}
