import type {
	PluginBridgeNavigate,
	PluginRouteLocation,
} from "@ryot-app/contract/modules/plugins/client";
import { Match } from "effect";

export type PluginNavigationRequest = { readonly href: string; readonly replace: boolean };

const dotSegment = /^(?:\.|%2e)(?:\.|%2e)?$/i;
const safeSearch = /^[\w\-.~!$&'()*+,;=:@%/?]*$/;
const safePath = /^\/[\w\-.~!$&'()*+,;=:@%/]*$/;

const dropTrailingSlash = (path: string) =>
	path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;

type PluginNavigationTarget = PluginBridgeNavigate["target"];

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

export function toGlobalHref(pluginSlug: string, target: PluginNavigationTarget) {
	return Match.value(target).pipe(
		Match.when({ kind: "route" }, (location) => {
			const search = location.search === "" ? "" : `?${location.search}`;
			return `/${pluginSlug}${location.path === "/" ? "" : location.path}${search}`;
		}),
		Match.when({ kind: "entity" }, ({ entityId }) => `/e/${encodeURIComponent(entityId)}`),
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
	return { kind: "route", path, search: location.search } satisfies PluginRouteLocation;
}

export function toNavigationRequest(
	pluginSlug: string,
	request: PluginBridgeNavigate,
): PluginNavigationRequest | undefined {
	const target = Match.value(request.target).pipe(
		Match.when({ kind: "route" }, validatePluginLocation),
		Match.when({ kind: "entity" }, (entity) => (entity.entityId === "" ? undefined : entity)),
		Match.exhaustive,
	);
	return target === undefined
		? undefined
		: { href: toGlobalHref(pluginSlug, target), replace: request.mode === "replace" };
}
