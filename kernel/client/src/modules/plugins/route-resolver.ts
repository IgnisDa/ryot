import { reservedPluginSlugs } from "@ryot-app/contract/modules/plugins/schemas";
import type { EntityRouteProvenance } from "@ryot-app/ryotql-recipes/entities";
import type {
	PluginClientCatalog,
	PluginClientCatalogEntry,
} from "@ryot-app/ryotql-recipes/plugin-client-catalog";

export type RouteTarget =
	| { readonly owner: "kernel"; readonly surface: { readonly kind: "not-found" } }
	| {
			readonly owner: "plugin";
			readonly surface: { readonly kind: "home" };
			readonly installation: PluginClientCatalogEntry;
	  };

export type EntityRouteTarget =
	| { readonly kind: "missing" }
	| { readonly kind: "installation-missing" }
	| { readonly kind: "unsupported"; readonly owner: "kernel" }
	| {
			readonly kind: "plugin";
			readonly entityId: string;
			readonly installation: PluginClientCatalogEntry;
			readonly entitySchemaSlug: NonNullable<EntityRouteProvenance>["entitySchemaSlug"];
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

export function resolveEntityRouteTarget(
	catalog: PluginClientCatalog,
	entityId: string,
	provenance: EntityRouteProvenance,
): EntityRouteTarget {
	if (provenance === null) {
		return { kind: "missing" };
	}
	if (provenance.entitySchemaPluginId === null) {
		return { kind: "unsupported", owner: "kernel" };
	}
	const installation = catalog.find(
		(candidate) => candidate.pluginId === provenance.entitySchemaPluginId,
	);
	return installation === undefined
		? { kind: "installation-missing" }
		: { entityId, installation, kind: "plugin", entitySchemaSlug: provenance.entitySchemaSlug };
}
