import {
	kernelPagePaths,
	type PluginBridgeNavigate,
	type PluginNavigationTarget,
	type PluginRouteLocation,
} from "@ryot-app/client-plugin-contract";
import { pluginPath, savedViewPath } from "@ryot-app/contract/modules/plugins/navigation";
import type { SavedViewReference } from "@ryot-app/contract/modules/plugins/references";
import type { PluginPackageId } from "@ryot-app/contract/schema/brands";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { Match } from "effect";

export type PluginNavigationRequest = { readonly href: string; readonly replace: boolean };

const dotSegment = /^(?:\.|%2e)(?:\.|%2e)?$/i;
const safeSearch = /^[\w\-.~!$&'()*+,;=:@%/?]*$/;
const safePath = /^\/[\w\-.~!$&'()*+,;=:@%/]*$/;

const dropTrailingSlash = (path: string) =>
	path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;

export const catalogPackageId = (catalog: PluginClientCatalog, pluginId: string) =>
	catalog.find((entry) => entry.pluginId === pluginId)?.packageId;

export const effectiveCatalogPlugin = (catalog: PluginClientCatalog, packageId: string) =>
	catalog.find((entry) => entry.packageId === packageId && entry.health !== "incompatible");

export const savedViewHref = (
	reference: SavedViewReference,
	packageId: PluginPackageId | null | undefined,
) => {
	if (reference.kind !== "plugin") {
		return savedViewPath(reference);
	}
	return packageId ? savedViewPath({ packageId, kind: "plugin", slug: reference.slug }) : undefined;
};

export function toPluginLocation(
	packageId: PluginPackageId,
	pathname: string,
	searchStr: string,
): PluginRouteLocation {
	const remainder = pathname.slice(pluginPath(packageId).length);
	const path = remainder.startsWith("/") ? dropTrailingSlash(remainder) : "/";
	return {
		path,
		kind: "route",
		search: searchStr.startsWith("?") ? searchStr.slice(1) : searchStr,
	};
}

export function toGlobalHref(target: PluginNavigationTarget, catalog: PluginClientCatalog) {
	return Match.value(target).pipe(
		Match.when({ kind: "plugin-route" }, (location) => {
			const search = location.search === "" ? "" : `?${location.search}`;
			return `${pluginPath(location.packageId, location.path)}${search}`;
		}),
		Match.when({ kind: "entity" }, ({ entityId }) => `/e/${encodeURIComponent(entityId)}`),
		Match.when({ kind: "saved-view" }, ({ reference }) =>
			savedViewHref(
				reference,
				reference.kind === "plugin" ? catalogPackageId(catalog, reference.pluginId) : null,
			),
		),
		Match.when({ kind: "kernel-page" }, ({ page }) => kernelPagePaths[page]),
		Match.exhaustive,
	);
}

export function validatePluginLocation(location: PluginRouteLocation) {
	const path = dropTrailingSlash(location.path);
	if (path.startsWith("//") || !safePath.test(path) || !safeSearch.test(location.search)) {
		return undefined;
	}
	if (path.split("/").some((segment) => dotSegment.test(segment))) {
		return undefined;
	}
	return { path, kind: "route", search: location.search } satisfies PluginRouteLocation;
}

export function toNavigationRequest(
	request: PluginBridgeNavigate,
	catalog: PluginClientCatalog,
): PluginNavigationRequest | undefined {
	const target = Match.value(request.target).pipe(
		Match.when({ kind: "plugin-route" }, (route) => {
			const location = validatePluginLocation({
				kind: "route",
				path: route.path,
				search: route.search,
			});
			return location === undefined ? undefined : { ...route, path: location.path };
		}),
		Match.when({ kind: "entity" }, (entity) => (entity.entityId === "" ? undefined : entity)),
		Match.when({ kind: "saved-view" }, (view) => {
			const reference = view.reference;
			return Match.value(reference).pipe(
				Match.when({ kind: "custom" }, ({ savedViewId }) =>
					savedViewId.length === 0 ? undefined : view,
				),
				Match.when({ kind: "plugin" }, ({ slug, pluginId }) =>
					pluginId.length === 0 || slug.length === 0 ? undefined : view,
				),
				Match.when({ kind: "kernel" }, ({ slug }) => (slug.length === 0 ? undefined : view)),
				Match.exhaustive,
			);
		}),
		Match.when({ kind: "kernel-page" }, (page) => page),
		Match.exhaustive,
	);
	const href = target === undefined ? undefined : toGlobalHref(target, catalog);
	return href === undefined ? undefined : { href, replace: request.mode === "replace" };
}
