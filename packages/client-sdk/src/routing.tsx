import type { PluginLogicalLocation } from "@ryot/contract/modules/plugins/client";
import {
	Fragment,
	createContext,
	useContext,
	useEffect,
	useEffectEvent,
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
import { reconcileStack, type PluginScreen } from "./navigation/stack";
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

const screenStyle: CSSProperties = {
	inset: 0,
	overflowY: "auto",
	position: "absolute",
	willChange: "transform",
	background: "var(--bg)",
	// Vertical only: containing the x axis would disable the browser's own back-swipe.
	overscrollBehaviorY: "contain",
};

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

type PluginRouterProps = {
	readonly navigation: PluginRouterNavigation;
	readonly definition: PluginRouterDefinition;
};

export const PluginRouter = ({ definition, navigation }: PluginRouterProps) => {
	const rootRef = useRef<HTMLDivElement>(null);
	const scrimRef = useRef<HTMLDivElement>(null);
	const phase = useRef<"idle" | "dragging" | "committing">("idle");
	const drag = useRef({ dx: 0, dy: 0, vx: 0, frame: 0, width: 0, lastX: 0, lastAt: 0 });
	const screenRefs = useRef(new Map<string, HTMLDivElement>());
	const isFirstEntry = useRef(true);
	const [stack, setStack] = useState<readonly PluginScreen[]>([]);
	const [leaving, setLeaving] = useState<PluginScreen | undefined>(undefined);
	const { edgeBack, entry } = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot);

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

	const screens = useMemo(
		() => (leaving === undefined ? stack : [...stack, leaving]),
		[stack, leaving],
	);

	const frameFor = (outgoingKey: string | undefined, incomingKey: string | undefined) => ({
		scrim: scrimRef.current,
		incoming: incomingKey === undefined ? null : (screenRefs.current.get(incomingKey) ?? null),
		outgoing: outgoingKey === undefined ? null : (screenRefs.current.get(outgoingKey) ?? null),
	});

	const applyEntry = useEffectEvent((effectEntry: PluginNavigationEntry) => {
		const result = reconcileStack(stack, effectEntry, resolve);
		const previousTop = stack.at(-1);
		const committing = phase.current === "committing";

		if (result.transition === "pop" && previousTop !== undefined) {
			setStack(result.stack);
			setLeaving(previousTop);
			const frame = frameFor(previousTop.key, result.stack.at(-1)?.key);
			void (committing ? Promise.resolve() : settleProgress(frame, 0, 1)).then(() => {
				phase.current = "idle";
				setLeaving(undefined);
				return undefined;
			});
			return;
		}

		setStack(result.stack);
		setLeaving(undefined);
		phase.current = "idle";
	});

	useEffect(() => {
		if (entry !== undefined) {
			applyEntry(entry);
		}
	}, [entry]);

	useEffect(() => {
		if (leaving !== undefined || screens.length === 0) {
			return;
		}
		for (const [key, element] of screenRefs.current) {
			if (!screens.some((screen) => screen.key === key)) {
				screenRefs.current.delete(key);
				continue;
			}
			element.style.transform = "";
			element.style.visibility = key === screens.at(-1)?.key ? "visible" : "hidden";
		}
		if (scrimRef.current) {
			scrimRef.current.style.opacity = "0";
		}
		if (isFirstEntry.current) {
			isFirstEntry.current = false;
			return;
		}
		if (document.hasFocus()) {
			screenRefs.current.get(screens.at(-1)?.key ?? "")?.focus({ preventScroll: true });
		}
	}, [screens, leaving]);

	const beginDrag = (event: PointerEvent<HTMLDivElement>) => {
		if (phase.current !== "idle" || stack.length < 2) {
			return;
		}
		drag.current = {
			dx: 0,
			dy: 0,
			vx: 0,
			frame: 0,
			lastX: event.clientX,
			lastAt: event.timeStamp,
			width: rootRef.current?.clientWidth ?? 0,
		};
		phase.current = "dragging";
	};

	const moveDrag = (event: PointerEvent<HTMLDivElement>, originX: number, originY: number) => {
		if (phase.current !== "dragging") {
			return;
		}
		const current = drag.current;
		const elapsed = event.timeStamp - current.lastAt;
		current.vx = elapsed > 0 ? (event.clientX - current.lastX) / elapsed : 0;
		current.lastX = event.clientX;
		current.lastAt = event.timeStamp;
		current.dx = event.clientX - originX;
		current.dy = event.clientY - originY;
		if (!current.frame && shouldEngage(current)) {
			current.frame = 1;
			const below = stack.at(-2);
			const element = below === undefined ? undefined : screenRefs.current.get(below.key);
			if (element) {
				element.style.visibility = "visible";
			}
		}
		if (!current.frame || prefersReducedMotion()) {
			return;
		}
		applyProgress(
			frameFor(stack.at(-1)?.key, stack.at(-2)?.key),
			dragProgress(current.dx, current.width),
		);
	};

	const endDrag = () => {
		if (phase.current !== "dragging") {
			return;
		}
		const current = drag.current;
		const frame = frameFor(stack.at(-1)?.key, stack.at(-2)?.key);
		const progress = dragProgress(current.dx, current.width);
		if (!current.frame || !shouldCommit({ dx: current.dx, vx: current.vx, width: current.width })) {
			phase.current = "idle";
			void settleProgress(frame, progress, 0).then(() => {
				const below = stack.at(-2);
				const element = below === undefined ? undefined : screenRefs.current.get(below.key);
				if (element && phase.current === "idle") {
					element.style.visibility = "hidden";
				}
				return undefined;
			});
			return;
		}
		phase.current = "committing";
		navigation.back();
		void settleProgress(frame, progress, 1);
	};

	if (screens.length === 0) {
		return null;
	}

	return (
		<div ref={rootRef} style={{ height: "100%", overflow: "hidden", position: "relative" }}>
			{screens.map((screen, position) => (
				<Fragment key={screen.key}>
					<Screen active={position === screens.length - 1} screen={screen} refs={screenRefs} />
					{position === screens.length - 2 && (
						<div ref={scrimRef} aria-hidden="true" style={scrimStyle} />
					)}
				</Fragment>
			))}
			{edgeBack && (
				<EdgeStrip onEnd={endDrag} onMove={moveDrag} onStart={beginDrag} phase={phase} />
			)}
		</div>
	);
};

function Screen(props: {
	readonly active: boolean;
	readonly screen: PluginScreen;
	readonly refs: RefObject<Map<string, HTMLDivElement>>;
}) {
	const { location, params } = props.screen;
	const value = useMemo(() => ({ location, params }), [location, params]);

	return (
		<div
			tabIndex={-1}
			style={screenStyle}
			inert={!props.active}
			aria-hidden={props.active ? undefined : true}
			ref={(element) => {
				if (element) {
					props.refs.current.set(props.screen.key, element);
				}
			}}
		>
			<RouterContext.Provider value={value}>
				<props.screen.component />
			</RouterContext.Provider>
		</div>
	);
}

function EdgeStrip(props: {
	readonly phase: { current: "idle" | "dragging" | "committing" };
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
