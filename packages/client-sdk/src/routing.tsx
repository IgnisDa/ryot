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

export type PluginRouteDefinition = {
	readonly path: string;
	readonly component: ComponentType;
};

type PluginRouterDefinition = {
	readonly home: ComponentType;
	readonly routes?: readonly PluginRouteDefinition[];
};

type PluginNavigateMode = "push" | "replace";

type PluginNavigateTo = {
	readonly path: string;
	readonly search?: Record<string, string>;
};

type RouterContextValue = {
	params: Record<string, string>;
	location: PluginLogicalLocation;
	navigate: (mode: PluginNavigateMode, to: PluginNavigateTo) => void;
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

export const usePluginNavigation = () => {
	const { navigate } = useRouterContext();
	return useMemo(
		() => ({
			push: (to: PluginNavigateTo) => navigate("push", to),
			replace: (to: PluginNavigateTo) => navigate("replace", to),
		}),
		[navigate],
	);
};

type PluginLinkProps = {
	readonly to: string;
	readonly search?: Record<string, string>;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick">;

export const PluginLink = ({ to, search, children, ...rest }: PluginLinkProps) => {
	const { navigate } = useRouterContext();
	const searchString = search ? new URLSearchParams(search).toString() : "";
	const href = searchString ? `${to}?${searchString}` : to;

	const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
			return;
		}
		event.preventDefault();
		navigate("push", search ? { path: to, search } : { path: to });
	};

	return (
		<a {...rest} href={href} onClick={onClick}>
			{children}
		</a>
	);
};

const decodeSegment = (segment: string) => {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
};

const matchRoute = (routes: readonly PluginRouteDefinition[], path: string) => {
	if (path === "/") {
		return undefined;
	}

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
	readonly navigate: (mode: PluginNavigateMode, to: PluginNavigateTo) => void;
};

export const PluginRouter = ({ definition, locations, navigate }: PluginRouterProps) => {
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
		const matched = matchRoute(definition.routes ?? [], location.path);
		return {
			params: matched?.params ?? {},
			component: matched?.component ?? definition.home,
		};
	}, [location, definition]);

	const contextValue = useMemo<RouterContextValue | undefined>(
		() => (location && route ? { location, params: route.params, navigate } : undefined),
		[location, route, navigate],
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
