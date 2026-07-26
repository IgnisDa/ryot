import type { PluginLogicalLocation } from "@ryot-app/client-plugin-contract";
import { EntityId } from "@ryot-app/contract/schema/brands";
import type { PluginClientCatalogEntry } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { useRouterState } from "@tanstack/react-router";
import { Match } from "effect";
import { useRef } from "react";

import { historyEntry } from "#/modules/navigation/history-entry";
import { usePluginCatalog } from "#/modules/plugins/catalog-provider";
import { toPluginLocation } from "#/modules/plugins/plugin-location";
import { resolveEntityRouteTarget, resolveRouteTarget } from "#/modules/plugins/route-resolver";

export type ActivePluginDestination = {
	readonly pathname: string;
	readonly location: PluginLogicalLocation;
	readonly entry: ReturnType<typeof historyEntry>;
	readonly installation: PluginClientCatalogEntry;
};

export function useActivePluginDestination(): ActivePluginDestination | null {
	const { catalog } = usePluginCatalog();
	const currentSnapshot = useRouterState({
		select: (state) =>
			state.status === "idle"
				? { location: state.resolvedLocation ?? state.location, matches: state.matches }
				: null,
	});
	const committedSnapshot = useRef(currentSnapshot);
	if (currentSnapshot !== null) {
		committedSnapshot.current = currentSnapshot;
	}
	const snapshot = currentSnapshot ?? committedSnapshot.current;
	if (snapshot === null) {
		return null;
	}
	const { location, matches } = snapshot;
	const entry = historyEntry(location.state);

	const entityMatch = matches.find((match) => match.routeId === "/_authenticated/e/$entityId");
	if (entityMatch !== undefined) {
		const provenance = entityMatch.loaderData?.provenance;
		if (provenance === undefined) {
			return null;
		}
		const target = resolveEntityRouteTarget(catalog, entityMatch.params.entityId, provenance);
		return Match.value(target).pipe(
			Match.when(
				{ kind: "plugin" },
				(plugin): ActivePluginDestination => ({
					entry,
					pathname: location.pathname,
					installation: plugin.installation,
					location: {
						kind: "entity",
						entitySchemaSlug: plugin.entitySchemaSlug,
						entityId: EntityId.make(plugin.entityId),
					},
				}),
			),
			Match.orElse(() => null),
		);
	}

	const pluginMatch = matches.find((match) => match.routeId === "/_authenticated/$pluginSlug");
	if (pluginMatch === undefined) {
		return null;
	}
	const target = resolveRouteTarget(catalog, pluginMatch.params.pluginSlug);
	return target.owner === "kernel"
		? null
		: {
				entry,
				pathname: location.pathname,
				installation: target.installation,
				location: toPluginLocation(
					pluginMatch.params.pluginSlug,
					location.pathname,
					location.searchStr,
				),
			};
}
