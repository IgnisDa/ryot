import type { PluginLogicalLocation } from "@ryot-app/contract/modules/plugins/client";
import { Match } from "effect";
import {
	Fragment,
	createContext,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	type AnchorHTMLAttributes,
	type ComponentType,
	type CSSProperties,
	type MouseEvent,
	type PointerEvent,
	type RefObject,
} from "react";

import { applyProgress, prefersReducedMotion, settleProgress } from "./navigation/animator";
import { EDGE_SWIPE_WIDTH, dragProgress, shouldCommit, shouldEngage } from "./navigation/gesture";
import {
	presentScreens,
	type Presentation,
	type PluginScreen,
	type ResolvePluginScreen,
	type ScreenRole,
} from "./navigation/stack";
import type { PluginNavigationEntry, PluginRouterNavigation } from "./navigation/store";
import { useRyot } from "./react";

export type PluginRouteDefinition = {
	readonly path: string;
	readonly component: ComponentType;
};

export type PluginHomeDefinition = {
	readonly component: ComponentType;
};

export type PluginRouterDefinition = {
	readonly notFound?: ComponentType;
	readonly home: PluginHomeDefinition;
	readonly routes?: readonly PluginRouteDefinition[];
};

type RouterContextValue = {
	params: Record<string, string>;
	location: PluginLogicalLocation;
};

const RouterContext = createContext<RouterContextValue | undefined>(undefined);

export type PluginChromeValue = {
	readonly back: () => void;
	readonly compact: boolean;
	readonly edgeBack: boolean;
	readonly safeAreaTop: number;
	readonly openDrawer: () => void;
	readonly entry: PluginNavigationEntry | undefined;
	readonly publishTitle: (title: string | null) => void;
};

export type PluginScreenSurface = {
	readonly isActive: boolean;
	readonly scrollRootRef: RefObject<HTMLDivElement | null>;
};

const PluginChromeContext = createContext<PluginChromeValue | undefined>(undefined);

const PluginScreenContext = createContext<PluginScreenSurface | undefined>(undefined);

export const usePluginChrome = () => {
	const context = useContext(PluginChromeContext);
	if (!context) {
		throw new Error("Plugin chrome hooks must be used within a mounted plugin router");
	}
	return context;
};

export const usePluginScreenSurface = () => {
	const context = useContext(PluginScreenContext);
	if (!context) {
		throw new Error("Plugin screen hooks must be used within a mounted plugin screen");
	}
	return context;
};

export const useRyotSafeArea = () => usePluginChrome().safeAreaTop;

export function usePluginTitle(title: string | null) {
	const { entry, publishTitle } = usePluginChrome();
	const { isActive } = usePluginScreenSurface();

	useEffect(() => {
		if (isActive) {
			publishTitle(title);
		}
	}, [entry, isActive, publishTitle, title]);
}

const useRouterContext = () => {
	const context = useContext(RouterContext);
	if (!context) {
		throw new Error("Plugin routing hooks must be used within a mounted plugin router");
	}
	return context;
};

export const usePluginLocation = () => useRouterContext().location;

export const usePluginParams = () => useRouterContext().params;

export const usePluginSearch = () =>
	Match.value(useRouterContext().location).pipe(
		Match.when({ kind: "route" }, ({ search }) => new URLSearchParams(search)),
		Match.when({ kind: "entity" }, () => new URLSearchParams()),
		Match.exhaustive,
	);

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

const EntityRendererUnavailable = () => (
	<main>
		<h1>Entity renderer unavailable</h1>
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
			return { params, route };
		}
	}

	return undefined;
};

export const createPluginRouteResolver = (
	definition: PluginRouterDefinition,
): ResolvePluginScreen => {
	return (location) =>
		Match.value(location).pipe(
			Match.when({ kind: "route" }, (route) => {
				if (route.path === "/") {
					return { params: {}, component: definition.home.component };
				}
				const matched = matchRoute(definition.routes ?? [], route.path);
				if (matched === undefined) {
					return { params: {}, component: definition.notFound ?? DefaultNotFound };
				}
				return { params: matched.params, component: matched.route.component };
			}),
			Match.when({ kind: "entity" }, () => ({ params: {}, component: EntityRendererUnavailable })),
			Match.exhaustive,
		);
};

const screenBase: CSSProperties = {
	inset: 0,
	overflowY: "auto",
	paddingBottom: 32,
	position: "absolute",
	willChange: "transform",
	background: "var(--bg)",
	// Vertical only: containing the x axis would disable the browser's own back-swipe.
	overscrollBehaviorY: "contain",
};

const hiddenScreenStyle: CSSProperties = { ...screenBase, visibility: "hidden" };
const visibleScreenStyle: CSSProperties = { ...screenBase, visibility: "visible" };

const scrimStyle: CSSProperties = {
	inset: 0,
	opacity: 0,
	background: "#000",
	position: "absolute",
	pointerEvents: "none",
};

const edgeStyle: CSSProperties = {
	left: 0,
	insetBlock: 0,
	position: "absolute",
	touchAction: "pan-y",
	width: EDGE_SWIPE_WIDTH,
};

const rootStyle: CSSProperties = { height: "100%", overflow: "hidden", position: "relative" };

const idle: Presentation = { kind: "idle" };

type PluginRouterProps = {
	readonly navigation: PluginRouterNavigation;
};

export const PluginRouter = ({ navigation }: PluginRouterProps) => {
	const rootRef = useRef<HTMLDivElement>(null);
	const scrimRef = useRef<HTMLDivElement>(null);
	const settling = useRef<Promise<void> | undefined>(undefined);
	const screenRefs = useRef(new Map<string, HTMLDivElement>());
	const isFirstEntry = useRef(true);
	const drag = useRef({
		dx: 0,
		dy: 0,
		vx: 0,
		width: 0,
		lastX: 0,
		lastAt: 0,
		active: false,
		engaged: false,
	});
	const [gesturePresentation, setGesturePresentation] = useState<Presentation>(idle);
	const { compact, edgeBack, entry, safeAreaTop, screens, transition } = useSyncExternalStore(
		navigation.subscribe,
		navigation.getSnapshot,
	);
	const chrome = useMemo<PluginChromeValue>(
		() => ({
			entry,
			compact,
			edgeBack,
			safeAreaTop,
			back: navigation.back,
			openDrawer: navigation.openDrawer,
			publishTitle: navigation.publishTitle,
		}),
		[compact, edgeBack, entry, navigation, safeAreaTop],
	);
	const popping = useMemo(
		() =>
			transition !== undefined && compact && !prefersReducedMotion()
				? {
						kind: "popping" as const,
						leaving: transition.leaving,
						incoming: transition.incoming,
						from:
							gesturePresentation.kind === "dragging"
								? dragProgress(drag.current.dx, drag.current.width)
								: 0,
					}
				: undefined,
		[compact, gesturePresentation, transition],
	);
	const presentation = popping ?? gesturePresentation;
	const presented = useMemo(() => presentScreens(screens, presentation), [screens, presentation]);

	const frameFor = (outgoingKey: string | undefined, incomingKey: string | undefined) => ({
		scrim: scrimRef.current,
		incoming: incomingKey === undefined ? null : (screenRefs.current.get(incomingKey) ?? null),
		outgoing: outgoingKey === undefined ? null : (screenRefs.current.get(outgoingKey) ?? null),
	});

	useLayoutEffect(() => {
		if (transition === undefined) {
			return undefined;
		}
		if (popping === undefined) {
			settling.current = undefined;
			setGesturePresentation(idle);
			navigation.completeTransition(transition.id);
			return undefined;
		}
		const frame = frameFor(popping.leaving.key, popping.incoming);
		const settle = settling.current ?? settleProgress(frame, popping.from, 1);
		settling.current = undefined;
		let cancelled = false;
		void settle.then(() => {
			if (!cancelled) {
				setGesturePresentation(idle);
				navigation.completeTransition(transition.id);
			}
			return undefined;
		});
		return () => {
			cancelled = true;
		};
	}, [navigation, popping, transition]);

	useLayoutEffect(() => {
		if (presentation.kind !== "idle") {
			return;
		}
		for (const element of screenRefs.current.values()) {
			element.style.transform = "";
		}
		if (scrimRef.current) {
			scrimRef.current.style.opacity = "0";
		}
	}, [presentation]);

	useEffect(() => {
		if (presentation.kind !== "idle" || screens.length === 0) {
			return;
		}
		if (isFirstEntry.current) {
			isFirstEntry.current = false;
			return;
		}
		if (document.hasFocus()) {
			screenRefs.current.get(screens.at(-1)?.key ?? "")?.focus({ preventScroll: true });
		}
	}, [screens, presentation]);

	const beginDrag = (event: PointerEvent<HTMLDivElement>) => {
		if (drag.current.active || settling.current !== undefined || screens.length < 2) {
			return;
		}
		drag.current = {
			dx: 0,
			dy: 0,
			vx: 0,
			active: true,
			engaged: false,
			lastX: event.clientX,
			lastAt: event.timeStamp,
			width: rootRef.current?.clientWidth ?? 0,
		};
	};

	const moveDrag = (event: PointerEvent<HTMLDivElement>, originX: number, originY: number) => {
		const current = drag.current;
		if (!current.active) {
			return;
		}
		const elapsed = event.timeStamp - current.lastAt;
		current.vx = elapsed > 0 ? (event.clientX - current.lastX) / elapsed : 0;
		current.lastX = event.clientX;
		current.lastAt = event.timeStamp;
		current.dx = event.clientX - originX;
		current.dy = event.clientY - originY;
		if (!current.engaged && shouldEngage(current)) {
			current.engaged = true;
			setGesturePresentation({ kind: "dragging" });
		}
		if (!current.engaged || prefersReducedMotion()) {
			return;
		}
		applyProgress(
			frameFor(screens.at(-1)?.key, screens.at(-2)?.key),
			dragProgress(current.dx, current.width),
		);
	};

	const endDrag = () => {
		const current = drag.current;
		if (!current.active) {
			return;
		}
		current.active = false;
		const frame = frameFor(screens.at(-1)?.key, screens.at(-2)?.key);
		const progress = dragProgress(current.dx, current.width);
		if (!current.engaged || !shouldCommit(current)) {
			void settleProgress(frame, progress, 0).then(() => {
				if (!drag.current.active) {
					setGesturePresentation(idle);
				}
				return undefined;
			});
			return;
		}
		settling.current = settleProgress(frame, progress, 1);
		navigation.back();
	};

	if (presented.length === 0) {
		return null;
	}

	const scrimAfter = presentation.kind === "popping" ? "active" : "beneath";

	return (
		<PluginChromeContext.Provider value={chrome}>
			<div ref={rootRef} style={rootStyle}>
				{presented.map(({ role, screen }) => (
					<Fragment key={screen.key}>
						<Screen role={role} screen={screen} refs={screenRefs} />
						{role === scrimAfter && <div ref={scrimRef} aria-hidden="true" style={scrimStyle} />}
					</Fragment>
				))}
				{edgeBack && <EdgeStrip onEnd={endDrag} onMove={moveDrag} onStart={beginDrag} />}
			</div>
		</PluginChromeContext.Provider>
	);
};

function Screen(props: {
	readonly role: ScreenRole;
	readonly screen: PluginScreen;
	readonly refs: RefObject<Map<string, HTMLDivElement>>;
}) {
	const active = props.role === "active";
	const scrollRoot = useRef<HTMLDivElement>(null);
	const { location, params } = props.screen;
	const value = useMemo(() => ({ location, params }), [location, params]);
	const surface = useMemo<PluginScreenSurface>(
		() => ({ isActive: active, scrollRootRef: scrollRoot }),
		[active],
	);

	return (
		<div
			tabIndex={-1}
			inert={!active}
			aria-hidden={active ? undefined : true}
			style={props.role === "hidden" ? hiddenScreenStyle : visibleScreenStyle}
			ref={(element) => {
				scrollRoot.current = element;
				if (element === null) {
					return undefined;
				}
				props.refs.current.set(props.screen.key, element);
				return () => {
					scrollRoot.current = null;
					props.refs.current.delete(props.screen.key);
				};
			}}
		>
			<PluginScreenContext.Provider value={surface}>
				<RouterContext.Provider value={value}>
					<props.screen.component />
				</RouterContext.Provider>
			</PluginScreenContext.Provider>
		</div>
	);
}

function EdgeStrip(props: {
	readonly onEnd: () => void;
	readonly onStart: (event: PointerEvent<HTMLDivElement>) => void;
	readonly onMove: (event: PointerEvent<HTMLDivElement>, originX: number, originY: number) => void;
}) {
	const origin = useRef({ x: 0, y: 0 });

	return (
		<div
			style={edgeStyle}
			aria-hidden="true"
			data-plugin-edge="back"
			onPointerUp={props.onEnd}
			onPointerCancel={props.onEnd}
			onPointerMove={(event) => props.onMove(event, origin.current.x, origin.current.y)}
			onPointerDown={(event) => {
				origin.current = { x: event.clientX, y: event.clientY };
				if (typeof event.currentTarget.setPointerCapture === "function") {
					event.currentTarget.setPointerCapture(event.pointerId);
				}
				props.onStart(event);
			}}
		/>
	);
}
