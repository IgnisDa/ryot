import {
	createViewHistory,
	restoreScrollTop,
	type ViewChange,
	type ViewEntry,
} from "@ryot-app/plugin-ui-sdk";
import { stableStringify } from "@ryot-app/ts-utils/json";
import {
	type AnyRouter,
	type ParsedLocation,
	useRouter,
	useRouterState,
} from "@tanstack/react-router";
import { createContext, type ReactNode, useContext, useLayoutEffect, useState } from "react";

import { historyEntry } from "#/modules/navigation/history-entry";
import { MAIN_CONTENT_ID } from "#/modules/navigation/skip-link";

type ScrollPositions = ReadonlyMap<string, number>;

type ClaimMainView = (identity: string | undefined) => void;

const MainViewClaimContext = createContext<undefined | ClaimMainView>(undefined);

const pathWithin = (root: Element, element: Element) => {
	const path: number[] = [];
	for (let node = element; node !== root;) {
		const parent = node.parentElement;
		if (parent === null) {
			return undefined;
		}
		path.unshift(Array.prototype.indexOf.call(parent.children, node));
		node = parent;
	}
	return path.join("/");
};

const DOCUMENT_SCROLLER = "document";

/** Refusing every location turns off TanStack's restoration and its reset to the top. */
export const mainViewRouterOptions = { scrollRestoration: () => false } as const;

const mainContent = () => document.getElementById(MAIN_CONTENT_ID);

const isViewScroller = (element: Element) =>
	element === document.documentElement || mainContent()?.contains(element) === true;

const scrollerPath = (element: Element) => {
	if (element === document.documentElement) {
		return DOCUMENT_SCROLLER;
	}
	const root = mainContent();
	return root === null ? undefined : pathWithin(root, element);
};

const scrollerAt = (path: string) => {
	if (path === DOCUMENT_SCROLLER) {
		return document.documentElement;
	}
	const root = mainContent();
	return root === null || path === ""
		? root
		: path
				.split("/")
				.reduce<Element | undefined>((node, index) => node?.children[Number(index)], root);
};

/** Replaces the route-derived identity of the main view while a surface owns its own navigation. */
export function useMainViewIdentity(identity: string | undefined) {
	const claim = useContext(MainViewClaimContext);
	if (claim === undefined) {
		throw new Error("useMainViewIdentity must be used inside MainViewProvider");
	}
	useLayoutEffect(() => claim(identity), [claim, identity]);
	useLayoutEffect(() => () => claim(undefined), [claim]);
}

/** Owns scroll and focus of the shell's main view across navigations. */
export function MainViewProvider(props: { readonly children: ReactNode }) {
	const router = useRouter();
	const [controller] = useState(() => createMainViewController(router));
	const resolved = useRouterState({ select: (state) => state.resolvedLocation });
	useLayoutEffect(() => controller.start(), [controller]);
	useLayoutEffect(() => {
		if (resolved !== undefined) {
			controller.settle(resolved);
		}
	}, [controller, resolved]);
	return <MainViewClaimContext value={controller.claim}>{props.children}</MainViewClaimContext>;
}

function createMainViewController(router: AnyRouter) {
	const views = createViewHistory<ScrollPositions>();
	let claim: string | undefined;
	let settled: undefined | ParsedLocation;
	let active: undefined | ViewEntry;
	let scrolled = new Set<HTMLElement>();
	let restoring: Array<() => void> = [];

	const identity = () => {
		const leaf = router.state.matches.at(-1);
		return claim ?? (leaf === undefined ? "" : `${leaf.routeId}\n${stableStringify(leaf.params)}`);
	};

	const positions = () => {
		const saved = new Map<string, number>();
		for (const element of scrolled) {
			const path = scrollerPath(element);
			if (path !== undefined) {
				saved.set(path, element.scrollTop);
			}
		}
		return saved;
	};

	const apply = (change: ViewChange, previous: undefined | ViewEntry, next: ViewEntry) => {
		if (change === "initial" || change === "same") {
			return;
		}
		for (const cancel of restoring) {
			cancel();
		}
		restoring = [];
		for (const element of scrolled) {
			element.scrollTop = 0;
		}
		scrolled = new Set();
		const root = mainContent();
		const saved = change === "restore" ? views.saved(next) : undefined;
		for (const [path, top] of saved ?? []) {
			const element = scrollerAt(path);
			if (element instanceof HTMLElement) {
				scrolled.add(element);
				restoring.push(restoreScrollTop(element, top));
			}
		}
		if (next.identity !== previous?.identity) {
			root?.focus({ preventScroll: true });
		}
	};

	const setClaim: ClaimMainView = (next) => {
		claim = next;
		// A claim that settles after its navigation renames the displayed view; it is not a navigation.
		const { status, resolvedLocation } = router.state;
		if (active !== undefined && status === "idle" && resolvedLocation === settled) {
			active = { key: active.key, identity: identity() };
			views.enter(active);
		}
	};

	const track = (event: Event) => {
		const target = event.target === document ? document.documentElement : event.target;
		if (target instanceof HTMLElement && isViewScroller(target)) {
			scrolled.add(target);
		}
	};

	return {
		claim: setClaim,
		settle: (location: ParsedLocation) => {
			const previous = active;
			active = { identity: identity(), key: historyEntry(location.state).key };
			settled = location;
			apply(views.enter(active), previous, active);
		},
		start: () => {
			history.scrollRestoration = "manual";
			document.addEventListener("scroll", track, { capture: true, passive: true });
			const stopSaving = router.subscribe("onBeforeLoad", () => {
				if (active !== undefined) {
					views.save(active, positions());
				}
			});
			return () => {
				document.removeEventListener("scroll", track, { capture: true });
				stopSaving();
				for (const cancel of restoring) {
					cancel();
				}
			};
		},
	};
}
