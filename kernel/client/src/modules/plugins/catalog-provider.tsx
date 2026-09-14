import { useRyotQuery } from "@ryot-app/client-sdk/react";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { Effect, Fiber } from "effect";
import {
	createContext,
	useContext,
	useEffect,
	useEffectEvent,
	useMemo,
	useState,
	type ReactNode,
} from "react";

import type { ApiScope } from "#/api/scope";
import { pluginCatalogQuery } from "#/modules/plugins/catalog";
import { PluginCatalogEventsService } from "#/modules/plugins/events";

type PluginCatalogProviderRuntime = {
	readonly runFork: (
		effect: Effect.Effect<never, never, PluginCatalogEventsService>,
		options?: Effect.RunOptions,
	) => Fiber.Fiber<never>;
};

type PluginCatalogContextValue = {
	readonly refetch: () => void;
	readonly catalog: PluginClientCatalog;
	readonly invalidationRevision: number;
};

const PluginCatalogContext = createContext<PluginCatalogContextValue | undefined>(undefined);

export function PluginCatalogProvider(props: {
	readonly scope: ApiScope;
	readonly children: ReactNode;
	readonly initialCatalog: PluginClientCatalog;
	readonly runtime: PluginCatalogProviderRuntime;
}) {
	const { userId, serverUrl } = props.scope;
	const { refetch, data: catalog = props.initialCatalog } = useRyotQuery(
		pluginCatalogQuery,
		props.initialCatalog,
	);
	const [invalidationRevision, setInvalidationRevision] = useState(0);
	const refreshCatalog = useEffectEvent(() => {
		setInvalidationRevision((revision) => revision + 1);
		refetch();
	});

	useEffect(() => {
		const subscription = props.runtime.runFork(
			Effect.flatMap(PluginCatalogEventsService, (service) =>
				service.subscribe({ userId, serverUrl }, refreshCatalog),
			),
		);
		return () => {
			Effect.runFork(Fiber.interrupt(subscription));
		};
	}, [props.runtime, serverUrl, userId]);

	const value = useMemo(
		() => ({ catalog, refetch, invalidationRevision }),
		[catalog, refetch, invalidationRevision],
	);

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
