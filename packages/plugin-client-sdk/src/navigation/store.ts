import type {
	PluginBridgeViewport,
	PluginLeadingIntent,
	PluginLogicalLocation,
} from "@ryot-app/plugin-client-contract";

import { type PluginScreen, reconcileStack, type ResolvePluginScreen } from "./stack";

export type PluginViewportInsets = Omit<PluginBridgeViewport, "type">;

export type PluginNavigationEntry = {
	readonly key: string;
	readonly index: number;
	readonly location: PluginLogicalLocation;
};

export type PluginNavigationTransition = {
	readonly id: number;
	readonly leaving: PluginScreen;
	readonly incoming: string | undefined;
};

export type PluginNavigationStore = {
	readonly getSnapshot: () => PluginNavigationSnapshot;
	readonly subscribe: (listener: () => void) => () => void;
};

export type PluginNavigationLocation = {
	readonly compact: boolean;
	readonly edgeBack: boolean;
	readonly leading: PluginLeadingIntent;
	readonly entry: PluginNavigationEntry;
};

export type PluginRouterNavigation = PluginNavigationStore & {
	readonly back: () => void;
	readonly openDrawer: () => void;
	readonly completeTransition: (id: number) => void;
	readonly publishTitle: (title: null | string) => void;
	readonly registerShortcut: (shortcut: string, press: () => void) => () => void;
};

export type PluginNavigationSnapshot = PluginViewportInsets & {
	readonly compact: boolean;
	readonly edgeBack: boolean;
	readonly leading: PluginLeadingIntent;
	readonly screens: readonly PluginScreen[];
	readonly entry: undefined | PluginNavigationEntry;
	readonly transition: undefined | PluginNavigationTransition;
};

export type PluginNavigationController = PluginNavigationStore & {
	readonly clear: () => void;
	readonly completeTransition: (id: number) => void;
	readonly setViewport: (insets: PluginViewportInsets) => void;
	readonly replaceDocument: (resolve: ResolvePluginScreen) => void;
	readonly setLocation: (location: PluginNavigationLocation) => PluginNavigationSnapshot;
};

const initialSnapshot = (insets: PluginViewportInsets): PluginNavigationSnapshot => ({
	...insets,
	screens: [],
	compact: false,
	edgeBack: false,
	leading: "none",
	entry: undefined,
	transition: undefined,
});

export const createPluginNavigationStore = (
	resolve: ResolvePluginScreen,
	initialInsets: PluginViewportInsets = { safeAreaTop: 0, safeAreaBottom: 0 },
): PluginNavigationController => {
	const listeners = new Set<() => void>();
	let nextTransitionId = 0;
	let snapshot = initialSnapshot(initialInsets);
	let resolver = resolve;

	const emit = (next: PluginNavigationSnapshot) => {
		snapshot = next;
		for (const listener of listeners) {
			listener();
		}
	};

	return {
		getSnapshot: () => snapshot,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		completeTransition: (id) => {
			if (snapshot.transition?.id === id) {
				emit({ ...snapshot, transition: undefined });
			}
		},
		clear: () =>
			emit(
				initialSnapshot({
					safeAreaTop: snapshot.safeAreaTop,
					safeAreaBottom: snapshot.safeAreaBottom,
				}),
			),
		replaceDocument: (next) => {
			resolver = next;
			emit(
				initialSnapshot({
					safeAreaTop: snapshot.safeAreaTop,
					safeAreaBottom: snapshot.safeAreaBottom,
				}),
			);
		},
		setViewport: (insets) => {
			if (
				snapshot.safeAreaTop !== insets.safeAreaTop ||
				snapshot.safeAreaBottom !== insets.safeAreaBottom
			) {
				emit({ ...snapshot, ...insets });
			}
		},
		setLocation: ({ entry, compact, leading, edgeBack }) => {
			const previousTop = snapshot.screens.at(-1);
			const result = reconcileStack(snapshot.screens, entry, resolver);
			const transition =
				compact && result.transition === "pop" && previousTop !== undefined
					? {
							leaving: previousTop,
							id: (nextTransitionId += 1),
							incoming: result.stack.at(-1)?.key,
						}
					: undefined;
			const next = {
				entry,
				compact,
				leading,
				edgeBack,
				transition,
				screens: result.stack,
				safeAreaTop: snapshot.safeAreaTop,
				safeAreaBottom: snapshot.safeAreaBottom,
			};
			emit(next);
			return next;
		},
	};
};
