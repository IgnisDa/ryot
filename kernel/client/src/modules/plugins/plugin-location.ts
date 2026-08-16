import type {
	PluginBridgeNavigate,
	PluginRouteLocation,
} from "@ryot-app/contract/modules/plugins/client";

export type PluginNavigationRequest = { readonly href: string; readonly replace: boolean };

const dotSegment = /^(?:\.|%2e)(?:\.|%2e)?$/i;
const safeSearch = /^[\w\-.~!$&'()*+,;=:@%/?]*$/;
const safePath = /^\/[\w\-.~!$&'()*+,;=:@%/]*$/;

const dropTrailingSlash = (path: string) =>
	path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;

export function toPluginLocation(
	pluginSlug: string,
	pathname: string,
	searchStr: string,
): PluginRouteLocation {
	const remainder = pathname.slice(`/${pluginSlug}`.length);
	const path = remainder.startsWith("/") ? dropTrailingSlash(remainder) : "/";
	return {
		path,
		kind: "route",
		search: searchStr.startsWith("?") ? searchStr.slice(1) : searchStr,
	};
}

export function toGlobalHref(pluginSlug: string, location: PluginRouteLocation) {
	const search = location.search === "" ? "" : `?${location.search}`;
	return `/${pluginSlug}${location.path === "/" ? "" : location.path}${search}`;
}

export function validatePluginLocation(location: PluginRouteLocation) {
	const path = dropTrailingSlash(location.path);
	if (path.startsWith("//") || !safePath.test(path) || !safeSearch.test(location.search)) {
		return undefined;
	}
	if (path.split("/").some((segment) => dotSegment.test(segment))) {
		return undefined;
	}
	return { kind: "route", path, search: location.search } satisfies PluginRouteLocation;
}

export function toNavigationRequest(
	pluginSlug: string,
	request: PluginBridgeNavigate,
): PluginNavigationRequest | undefined {
	const location = validatePluginLocation(request.location);
	return location === undefined
		? undefined
		: { href: toGlobalHref(pluginSlug, location), replace: request.mode === "replace" };
}
