import { type CatalogRegistry, catalogRegistry } from "@ryot-app/i18n/catalog";
import type { PluginBridgeLocale } from "@ryot-app/plugin-client-contract";

export type PluginLocaleStore = {
	readonly getSnapshot: () => PluginLocaleSnapshot;
	readonly subscribe: (listener: () => void) => () => void;
};

export type PluginLocaleSnapshot = {
	readonly locale: string;
	readonly registry: CatalogRegistry;
	readonly isPending: undefined | ((namespace: string) => boolean);
};

type PluginLocaleRoot = { readonly setAttribute: (name: string, value: string) => void };

const snapshotOf = (payload: Omit<PluginBridgeLocale, "type">): PluginLocaleSnapshot => {
	const pending = new Set(payload.pendingNamespaces);
	return {
		locale: payload.locale,
		registry: catalogRegistry(payload.catalogs),
		isPending: pending.size === 0 ? undefined : (namespace) => pending.has(namespace),
	};
};

/**
 * The host's locale and catalogs, replaced wholesale by each `locale` message, which also sets the
 * document's `lang` and `dir`.
 */
export const createPluginLocaleStore = (
	initial: Omit<PluginBridgeLocale, "type">,
	root: PluginLocaleRoot,
) => {
	const apply = (payload: Omit<PluginBridgeLocale, "type">) => {
		root.setAttribute("lang", payload.locale);
		root.setAttribute("dir", payload.dir);
		return snapshotOf(payload);
	};
	let snapshot = apply(initial);
	const listeners = new Set<() => void>();
	return {
		getSnapshot: () => snapshot,
		clear: () => listeners.clear(),
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		update: (payload: Omit<PluginBridgeLocale, "type">) => {
			snapshot = apply(payload);
			for (const listener of listeners) {
				listener();
			}
		},
	};
};
