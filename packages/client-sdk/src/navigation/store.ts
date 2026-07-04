import type { PluginLeadingIntent, PluginLogicalLocation } from "@ryot-app/client-plugin-contract";

import { reconcileStack, type PluginScreen, type ResolvePluginScreen } from "./stack";

export type PluginNavigationEntry = {
	readonly key: string;
	readonly index: number;
	readonly location: PluginLogicalLocation;
};

export type PluginNavigationSnapshot = {
	readonly compact: boolean;
	readonly edgeBack: boolean;
	readonly safeAreaTop: number;
	readonly leading: PluginLeadingIntent;
	readonly screens: readonly PluginScreen[];
	readonly entry: PluginNavigationEntry | undefined;
	readonly transition: PluginNavigationTransition | undefined;
};

export type PluginNavigationLocation = {
	readonly compact: boolean;
	readonly edgeBack: boolean;
	readonly leading: PluginLeadingIntent;
	readonly entry: PluginNavigationEntry;
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

export type PluginRouterNavigation = PluginNavigationStore & {
	readonly back: () => void;
	readonly openDrawer: () => void;
	readonly completeTransition: (id: number) => void;
	readonly publishTitle: (title: string | null) => void;
};

export type PluginNavigationController = PluginNavigationStore & {
	readonly clear: () => void;
	readonly completeTransition: (id: number) => void;
	readonly setViewport: (safeAreaTop: number) => void;
	readonly setLocation: (location: PluginNavigationLocation) => PluginNavigationSnapshot;
};

const initialSnapshot = (safeAreaTop: number): PluginNavigationSnapshot => ({
	screens: [],
	safeAreaTop,
	compact: false,
	edgeBack: false,
	leading: "none",
	entry: undefined,
	transition: undefined,
});

export const createPluginNavigationStore = (
	resolve: ResolvePluginScreen,
	initialSafeAreaTop = 0,
): PluginNavigationController => {
	const listeners = new Set<() => void>();
	let nextTransitionId = 0;
	let snapshot = initialSnapshot(initialSafeAreaTop);

	const emit = (next: PluginNavigationSnapshot) => {
		snapshot = next;
		for (const listener of listeners) {
			listener();
		}
	};

	return {
		getSnapshot: () => snapshot,
		clear: () => emit(initialSnapshot(snapshot.safeAreaTop)),
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		setViewport: (safeAreaTop) => {
			if (snapshot.safeAreaTop !== safeAreaTop) {
				emit({ ...snapshot, safeAreaTop });
			}
		},
		completeTransition: (id) => {
			if (snapshot.transition?.id === id) {
				emit({ ...snapshot, transition: undefined });
			}
		},
		setLocation: ({ compact, edgeBack, entry, leading }) => {
			const previousTop = snapshot.screens.at(-1);
			const result = reconcileStack(snapshot.screens, entry, resolve);
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
			};
			emit(next);
			return next;
		},
	};
};
