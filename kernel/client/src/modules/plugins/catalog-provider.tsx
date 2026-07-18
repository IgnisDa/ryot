import { useRyotQuery } from "@ryot-app/client-sdk/react";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { Effect, Fiber } from "effect";
import {
	createContext,
	useContext,
	useEffect,
	useEffectEvent,
	useMemo,
	type ReactNode,
} from "react";

import type { ApiScope } from "#/api/scope";
import { pluginCatalogQuery, type PluginCatalogRuntime } from "#/modules/plugins/catalog";
import { PluginCatalogEventsService } from "#/modules/plugins/events";

type PluginCatalogProviderRuntime = PluginCatalogRuntime & {
	readonly runFork: (
		effect: Effect.Effect<never, never, PluginCatalogEventsService>,
		options?: Effect.RunOptions,
	) => Fiber.Fiber<never>;
};

type PluginCatalogContextValue = {
	readonly refetch: () => void;
	readonly catalog: PluginClientCatalog;
};

const PluginCatalogContext = createContext<PluginCatalogContextValue | undefined>(undefined);

export function PluginCatalogProvider(props: {
	readonly scope: ApiScope;
	readonly children: ReactNode;
	readonly initialCatalog: PluginClientCatalog;
	readonly runtime: PluginCatalogProviderRuntime;
}) {
	const { serverUrl, userId } = props.scope;
	const input = useMemo(
		() => ({ runtime: props.runtime, initialData: props.initialCatalog }),
		[props.initialCatalog, props.runtime],
	);
	const { data: catalog = props.initialCatalog, refetch } = useRyotQuery(pluginCatalogQuery, input);
	const refreshCatalog = useEffectEvent(refetch);

	useEffect(() => {
		const subscription = props.runtime.runFork(
			Effect.flatMap(PluginCatalogEventsService, (service) =>
				service.subscribe({ serverUrl, userId }, refreshCatalog),
			),
		);
		return () => {
			Effect.runFork(Fiber.interrupt(subscription));
		};
	}, [props.runtime, serverUrl, userId]);

	const value = useMemo(() => ({ catalog, refetch }), [catalog, refetch]);

	return (
		<PluginCatalogContext.Provider value={value}>{props.children}</PluginCatalogContext.Provider>
	);
}

export function usePluginCatalog() {
	const context = useContext(PluginCatalogContext);
	if (context === undefined) {
		throw new Error("usePluginCatalog must be used within PluginCatalogProvider");
	}
	return context;
}
