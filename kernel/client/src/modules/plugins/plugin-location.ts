import {
	kernelPagePaths,
	type PluginBridgeNavigate,
	type PluginNavigationTarget,
	type PluginRouteLocation,
} from "@ryot-app/client-plugin-contract";
import { pluginPath, savedViewPath } from "@ryot-app/contract/modules/plugins/navigation";
import { PluginId } from "@ryot-app/contract/schema/brands";
import { Match } from "effect";

export type PluginNavigationRequest = { readonly href: string; readonly replace: boolean };

const dotSegment = /^(?:\.|%2e)(?:\.|%2e)?$/i;
const safeSearch = /^[\w\-.~!$&'()*+,;=:@%/?]*$/;
const safePath = /^\/[\w\-.~!$&'()*+,;=:@%/]*$/;

const dropTrailingSlash = (path: string) =>
	path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;

export function toPluginLocation(
	pluginId: string,
	pathname: string,
	searchStr: string,
): PluginRouteLocation {
	const remainder = pathname.slice(pluginPath(PluginId.make(pluginId)).length);
	const path = remainder.startsWith("/") ? dropTrailingSlash(remainder) : "/";
	return {
		path,
		kind: "route",
		search: searchStr.startsWith("?") ? searchStr.slice(1) : searchStr,
	};
}

export function toGlobalHref(target: PluginNavigationTarget) {
	return Match.value(target).pipe(
		Match.when({ kind: "plugin-route" }, (location) => {
			const search = location.search === "" ? "" : `?${location.search}`;
			return `${pluginPath(location.pluginId, location.path)}${search}`;
		}),
		Match.when({ kind: "entity" }, ({ entityId }) => `/e/${encodeURIComponent(entityId)}`),
		Match.when({ kind: "saved-view" }, ({ reference }) => savedViewPath(reference)),
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
): PluginNavigationRequest | undefined {
	const target = Match.value(request.target).pipe(
		Match.when({ kind: "plugin-route" }, (route) => {
			if (route.pluginId.length === 0) {
				return undefined;
			}
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
	return target === undefined
		? undefined
		: { href: toGlobalHref(target), replace: request.mode === "replace" };
}
