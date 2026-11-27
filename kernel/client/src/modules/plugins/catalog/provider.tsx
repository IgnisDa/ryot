import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { Effect, Fiber } from "effect";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useEffectEvent,
	useMemo,
	useRef,
	useState,
} from "react";

import type { ApiScope } from "#/api/scope";
import { PluginCatalogEventsService } from "#/modules/plugins/catalog/events";
import { pluginCatalogQuery } from "#/modules/plugins/catalog/service";

type PluginCatalogContextValue = {
	readonly refetch: () => void;
	readonly catalog: PluginClientCatalog;
	readonly invalidationRevision: number;
};

type PluginCatalogProviderRuntime = {
	readonly runFork: (
		effect: Effect.Effect<never, never, PluginCatalogEventsService>,
		options?: Effect.RunOptions,
	) => Fiber.Fiber<never>;
};

const PluginCatalogContext = createContext<undefined | PluginCatalogContextValue>(undefined);

export function usePluginCatalog() {
	const context = useContext(PluginCatalogContext);
	if (context === undefined) {
		throw new Error("usePluginCatalog must be used within PluginCatalogProvider");
	}
	return context;
}

export function useIngestionCatalogRefresh(refetch: () => void) {
	const { invalidationRevision } = usePluginCatalog();
	const previous = useRef(invalidationRevision);
	const refresh = useEffectEvent(refetch);
	useEffect(() => {
		if (previous.current !== invalidationRevision) {
			previous.current = invalidationRevision;
			refresh();
		}
	}, [invalidationRevision]);
}

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
