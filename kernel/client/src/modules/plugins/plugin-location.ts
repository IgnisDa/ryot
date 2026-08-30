import type {
	PluginBridgeNavigate,
	PluginNavigationTarget,
	PluginRouteLocation,
} from "@ryot-app/client-plugin-contract";
import { Match } from "effect";

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

export function toGlobalHref(target: PluginNavigationTarget) {
	return Match.value(target).pipe(
		Match.when({ kind: "plugin-route" }, (location) => {
			const search = location.search === "" ? "" : `?${location.search}`;
			return `/${encodeURIComponent(location.pluginSlug)}${location.path === "/" ? "" : location.path}${search}`;
		}),
		Match.when({ kind: "entity" }, ({ entityId }) => `/e/${encodeURIComponent(entityId)}`),
		Match.when({ kind: "saved-view" }, ({ slug }) => `/v/${encodeURIComponent(slug)}`),
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
			const location = validatePluginLocation({
				kind: "route",
				path: route.path,
				search: route.search,
			});
			return location === undefined ? undefined : { ...route, path: location.path };
		}),
		Match.when({ kind: "entity" }, (entity) => (entity.entityId === "" ? undefined : entity)),
		Match.when({ kind: "saved-view" }, (view) => (view.slug === "" ? undefined : view)),
		Match.exhaustive,
	);
	return target === undefined
		? undefined
		: { href: toGlobalHref(target), replace: request.mode === "replace" };
}
