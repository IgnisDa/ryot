import type { PluginLogicalLocation } from "@ryot/contract/modules/plugins/client";
import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
	type AnchorHTMLAttributes,
	type ComponentType,
	type MouseEvent,
} from "react";

import { useRyot } from "./react";

export type PluginRouteDefinition = {
	readonly path: string;
	readonly component: ComponentType;
};

type PluginRouterDefinition = {
	readonly home: ComponentType;
	readonly notFound?: ComponentType;
	readonly routes?: readonly PluginRouteDefinition[];
};

type RouterContextValue = {
	params: Record<string, string>;
	location: PluginLogicalLocation;
};

const RouterContext = createContext<RouterContextValue | undefined>(undefined);

const useRouterContext = () => {
	const context = useContext(RouterContext);
	if (!context) {
		throw new Error("Plugin routing hooks must be used within a mounted plugin router");
	}
	return context;
};

export const usePluginLocation = () => useRouterContext().location;

export const usePluginParams = () => useRouterContext().params;

export const usePluginSearch = () => new URLSearchParams(useRouterContext().location.search);

type PluginLinkProps = {
	readonly to: string;
	readonly search?: Record<string, string>;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "download" | "href" | "target">;

export const PluginLink = ({
	to,
	search,
	onClick,
	children,
	onAuxClick,
	...rest
}: PluginLinkProps) => {
	const client = useRyot();
	const searchString = search ? new URLSearchParams(search).toString() : "";
	const href = searchString ? `${to}?${searchString}` : to;

	const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
		onClick?.(event);
		if (event.defaultPrevented) {
			return;
		}
		event.preventDefault();
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
			return;
		}
		client.navigation.push(search ? { path: to, search } : { path: to });
	};
	const handleAuxClick = (event: MouseEvent<HTMLAnchorElement>) => {
		onAuxClick?.(event);
		if (!event.defaultPrevented) {
			event.preventDefault();
		}
	};

	return (
		<a {...rest} href={href} onAuxClick={handleAuxClick} onClick={handleClick}>
			{children}
		</a>
	);
};

const DefaultNotFound = () => (
	<main>
		<h1>Page not found</h1>
	</main>
);

const decodeSegment = (segment: string) => {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
};

const matchRoute = (routes: readonly PluginRouteDefinition[], path: string) => {
	const segments = path.split("/");
	for (const route of routes) {
		const patternSegments = route.path.split("/");
		if (patternSegments.length !== segments.length) {
			continue;
		}

		const params: Record<string, string> = {};
		const matched = patternSegments.every((patternSegment, index) => {
			const segment = segments[index] ?? "";
			if (patternSegment.startsWith("$")) {
				params[patternSegment.slice(1)] = decodeSegment(segment);
				return true;
			}
			return patternSegment === segment;
		});

		if (matched) {
			return { component: route.component, params };
		}
	}

	return undefined;
};

export type PluginLocationStore = {
	readonly subscribe: (listener: () => void) => () => void;
	readonly getSnapshot: () => PluginLogicalLocation | undefined;
};

export type PluginLocationController = PluginLocationStore & {
	readonly set: (location: PluginLogicalLocation) => void;
};

export const createPluginLocationStore = (): PluginLocationController => {
	const listeners = new Set<() => void>();
	let current: PluginLogicalLocation | undefined;

	return {
		getSnapshot: () => current,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		set: (location) => {
			current = location;
			for (const listener of listeners) {
				listener();
			}
		},
	};
};

type PluginRouterProps = {
	readonly locations: PluginLocationStore;
	readonly definition: PluginRouterDefinition;
};

export const PluginRouter = ({ definition, locations }: PluginRouterProps) => {
	const isFirstLocation = useRef(true);
	const containerRef = useRef<HTMLDivElement>(null);
	const location = useSyncExternalStore(locations.subscribe, locations.getSnapshot);

	useEffect(() => {
		if (!location) {
			return;
		}
		if (isFirstLocation.current) {
			isFirstLocation.current = false;
			return;
		}
		if (document.hasFocus()) {
			containerRef.current?.focus({ preventScroll: true });
		}
	}, [location]);

	const route = useMemo(() => {
		if (!location) {
			return undefined;
		}
		if (location.path === "/") {
			return { component: definition.home, params: {} };
		}
		const matched = matchRoute(definition.routes ?? [], location.path);
		return {
			params: matched?.params ?? {},
			component: matched?.component ?? definition.notFound ?? DefaultNotFound,
		};
	}, [location, definition]);

	const contextValue = useMemo<RouterContextValue | undefined>(
		() => (location && route ? { location, params: route.params } : undefined),
		[location, route],
	);

	if (!contextValue || !route) {
		return null;
	}

	return (
		<RouterContext.Provider value={contextValue}>
			<div tabIndex={-1} ref={containerRef}>
				<route.component />
			</div>
		</RouterContext.Provider>
	);
};
