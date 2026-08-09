import type { PluginLogicalLocation } from "@ryot/contract/modules/plugins/client";

export type PluginNavigationEntry = {
	readonly key: string;
	readonly index: number;
	readonly location: PluginLogicalLocation;
};

export type PluginNavigationSnapshot = {
	readonly edgeBack: boolean;
	readonly entry: PluginNavigationEntry | undefined;
};

export type PluginNavigationStore = {
	readonly getSnapshot: () => PluginNavigationSnapshot;
	readonly subscribe: (listener: () => void) => () => void;
};

export type PluginRouterNavigation = PluginNavigationStore & {
	readonly back: () => void;
};

export type PluginNavigationController = PluginNavigationStore & {
	readonly clear: () => void;
	readonly setEdgeBack: (enabled: boolean) => void;
	readonly setEntry: (entry: PluginNavigationEntry) => void;
};

export const createPluginNavigationStore = (): PluginNavigationController => {
	const listeners = new Set<() => void>();
	let snapshot: PluginNavigationSnapshot = { edgeBack: false, entry: undefined };

	const emit = (next: PluginNavigationSnapshot) => {
		snapshot = next;
		for (const listener of listeners) {
			listener();
		}
	};

	return {
		getSnapshot: () => snapshot,
		setEntry: (entry) => emit({ ...snapshot, entry }),
		clear: () => emit({ edgeBack: false, entry: undefined }),
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		setEdgeBack: (edgeBack) => {
			if (edgeBack !== snapshot.edgeBack) {
				emit({ ...snapshot, edgeBack });
			}
		},
	};
};
