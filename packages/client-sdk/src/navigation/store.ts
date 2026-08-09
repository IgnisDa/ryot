import type { PluginLogicalLocation } from "@ryot/contract/modules/plugins/client";

export type PluginNavigationEntry = {
	readonly key: string;
	readonly index: number;
	readonly location: PluginLogicalLocation;
};

export type PluginNavigationSnapshot = {
	readonly compact: boolean;
	readonly edgeBack: boolean;
	readonly entry: PluginNavigationEntry | undefined;
};

export type PluginEdgeState = Omit<PluginNavigationSnapshot, "entry">;

export type PluginNavigationStore = {
	readonly getSnapshot: () => PluginNavigationSnapshot;
	readonly subscribe: (listener: () => void) => () => void;
};

export type PluginRouterNavigation = PluginNavigationStore & {
	readonly back: () => void;
};

export type PluginNavigationController = PluginNavigationStore & {
	readonly clear: () => void;
	readonly setEdge: (edge: PluginEdgeState) => void;
	readonly setEntry: (entry: PluginNavigationEntry) => void;
};

export const createPluginNavigationStore = (): PluginNavigationController => {
	const listeners = new Set<() => void>();
	let snapshot: PluginNavigationSnapshot = { compact: false, edgeBack: false, entry: undefined };

	const emit = (next: PluginNavigationSnapshot) => {
		snapshot = next;
		for (const listener of listeners) {
			listener();
		}
	};

	return {
		getSnapshot: () => snapshot,
		setEntry: (entry) => emit({ ...snapshot, entry }),
		clear: () => emit({ compact: false, edgeBack: false, entry: undefined }),
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		setEdge: ({ compact, edgeBack }) => {
			if (compact !== snapshot.compact || edgeBack !== snapshot.edgeBack) {
				emit({ ...snapshot, compact, edgeBack });
			}
		},
	};
};
