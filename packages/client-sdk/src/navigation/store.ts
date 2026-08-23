import type { PluginLogicalLocation } from "@ryot/contract/modules/plugins/client";

import { reconcileStack, type PluginScreen, type ResolvePluginScreen } from "./stack";

export type PluginNavigationEntry = {
	readonly key: string;
	readonly index: number;
	readonly location: PluginLogicalLocation;
};

export type PluginNavigationSnapshot = {
	readonly compact: boolean;
	readonly edgeBack: boolean;
	readonly screens: readonly PluginScreen[];
	readonly entry: PluginNavigationEntry | undefined;
	readonly transition: PluginNavigationTransition | undefined;
};

export type PluginNavigationLocation = {
	readonly compact: boolean;
	readonly edgeBack: boolean;
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
	readonly completeTransition: (id: number) => void;
};

export type PluginNavigationController = PluginNavigationStore & {
	readonly clear: () => void;
	readonly completeTransition: (id: number) => void;
	readonly setLocation: (location: PluginNavigationLocation) => PluginNavigationSnapshot;
};

const initialSnapshot = (): PluginNavigationSnapshot => ({
	screens: [],
	compact: false,
	edgeBack: false,
	entry: undefined,
	transition: undefined,
});

export const createPluginNavigationStore = (
	resolve: ResolvePluginScreen,
): PluginNavigationController => {
	const listeners = new Set<() => void>();
	let nextTransitionId = 0;
	let snapshot = initialSnapshot();

	const emit = (next: PluginNavigationSnapshot) => {
		snapshot = next;
		for (const listener of listeners) {
			listener();
		}
	};

	return {
		getSnapshot: () => snapshot,
		clear: () => emit(initialSnapshot()),
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		completeTransition: (id) => {
			if (snapshot.transition?.id === id) {
				emit({ ...snapshot, transition: undefined });
			}
		},
		setLocation: ({ compact, edgeBack, entry }) => {
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
			const next = { compact, edgeBack, entry, transition, screens: result.stack };
			emit(next);
			return next;
		},
	};
};
