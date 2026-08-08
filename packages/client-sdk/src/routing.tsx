import type { PluginLogicalLocation } from "@ryot/contract/modules/plugins/client";
import {
	Fragment,
	createContext,
	useContext,
	useEffect,
	useEffectEvent,
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
	reconcileStack,
	type Presentation,
	type PluginScreen,
	type ScreenRole,
} from "./navigation/stack";
import type { PluginNavigationEntry, PluginRouterNavigation } from "./navigation/store";
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

const screenBase: CSSProperties = {
	inset: 0,
	overflowY: "auto",
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
	readonly definition: PluginRouterDefinition;
};

export const PluginRouter = ({ definition, navigation }: PluginRouterProps) => {
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
	const [screens, setScreens] = useState<readonly PluginScreen[]>([]);
	const [presentation, setPresentation] = useState<Presentation>(idle);
	const { compact, edgeBack, entry } = useSyncExternalStore(
		navigation.subscribe,
		navigation.getSnapshot,
	);

	const resolve = (location: PluginLogicalLocation) => {
		if (location.path === "/") {
			return { component: definition.home, params: {} };
		}
		const matched = matchRoute(definition.routes ?? [], location.path);
		return {
			params: matched?.params ?? {},
			component: matched?.component ?? definition.notFound ?? DefaultNotFound,
		};
	};

	const presented = useMemo(() => presentScreens(screens, presentation), [screens, presentation]);

	const frameFor = (outgoingKey: string | undefined, incomingKey: string | undefined) => ({
		scrim: scrimRef.current,
		incoming: incomingKey === undefined ? null : (screenRefs.current.get(incomingKey) ?? null),
		outgoing: outgoingKey === undefined ? null : (screenRefs.current.get(outgoingKey) ?? null),
	});

	const applyEntry = useEffectEvent((effectEntry: PluginNavigationEntry) => {
		const result = reconcileStack(screens, effectEntry, resolve);
		const previousTop = screens.at(-1);
		setScreens(result.stack);
		if (
			result.transition !== "pop" ||
			previousTop === undefined ||
			!(compact && !prefersReducedMotion())
		) {
			settling.current = undefined;
			setPresentation(idle);
			return;
		}
		setPresentation({
			kind: "popping",
			leaving: previousTop,
			incoming: result.stack.at(-1)?.key,
			from:
				presentation.kind === "dragging" ? dragProgress(drag.current.dx, drag.current.width) : 0,
		});
	});

	useEffect(() => {
		if (entry !== undefined) {
			applyEntry(entry);
		}
	}, [entry]);

	useLayoutEffect(() => {
		if (presentation.kind !== "popping") {
			return undefined;
		}
		const frame = frameFor(presentation.leaving.key, presentation.incoming);
		const settle = settling.current ?? settleProgress(frame, presentation.from, 1);
		settling.current = undefined;
		let cancelled = false;
		void settle.then(() => {
			if (!cancelled) {
				setPresentation(idle);
			}
			return undefined;
		});
		return () => {
			cancelled = true;
		};
	}, [presentation]);

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
			setPresentation({ kind: "dragging" });
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
					setPresentation(idle);
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
		<div ref={rootRef} style={rootStyle}>
			{presented.map(({ role, screen }) => (
				<Fragment key={screen.key}>
					<Screen role={role} screen={screen} refs={screenRefs} />
					{role === scrimAfter && <div ref={scrimRef} aria-hidden="true" style={scrimStyle} />}
				</Fragment>
			))}
			{edgeBack && <EdgeStrip onEnd={endDrag} onMove={moveDrag} onStart={beginDrag} />}
		</div>
	);
};

function Screen(props: {
	readonly role: ScreenRole;
	readonly screen: PluginScreen;
	readonly refs: RefObject<Map<string, HTMLDivElement>>;
}) {
	const active = props.role === "active";
	const { location, params } = props.screen;
	const value = useMemo(() => ({ location, params }), [location, params]);

	return (
		<div
			tabIndex={-1}
			inert={!active}
			aria-hidden={active ? undefined : true}
			style={props.role === "hidden" ? hiddenScreenStyle : visibleScreenStyle}
			ref={(element) => {
				if (element === null) {
					return undefined;
				}
				props.refs.current.set(props.screen.key, element);
				return () => {
					props.refs.current.delete(props.screen.key);
				};
			}}
		>
			<RouterContext.Provider value={value}>
				<props.screen.component />
			</RouterContext.Provider>
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
