import type { PluginThemeSnapshot } from "@ryot-app/client-plugin-contract";

import {
	applyThemePreference,
	resolveTheme,
	type ThemeRoot,
	type ThemePreference,
} from "#/modules/theme/preference";

type ThemeMedia = {
	readonly matches: boolean;
	addEventListener(type: "change", listener: () => void): void;
	removeEventListener(type: "change", listener: () => void): void;
};

export type ThemeStore = {
	readonly destroy: () => void;
	readonly getPreference: () => ThemePreference;
	readonly getSnapshot: () => PluginThemeSnapshot;
	readonly subscribe: (listener: () => void) => () => void;
	readonly setPreference: (preference: ThemePreference) => void;
};

export function createThemeStore(
	initialPreference: ThemePreference,
	options: {
		readonly root?: ThemeRoot;
		readonly media?: ThemeMedia;
	} = {},
): ThemeStore {
	const root = options.root ?? document.documentElement;
	const media = options.media ?? window.matchMedia("(prefers-color-scheme: dark)");
	const listeners = new Set<() => void>();
	let preference = initialPreference;
	let snapshot = resolveSnapshot();

	function resolveSnapshot(): PluginThemeSnapshot {
		applyThemePreference(root, preference);
		return { resolvedMode: resolveTheme(preference, media.matches ? "dark" : "light") };
	}

	function publish() {
		snapshot = resolveSnapshot();
		for (const listener of listeners) {
			listener();
		}
	}

	function handleMediaChange() {
		if (preference === "system") {
			publish();
		}
	}

	media.addEventListener("change", handleMediaChange);

	return {
		getSnapshot: () => snapshot,
		getPreference: () => preference,
		destroy: () => {
			media.removeEventListener("change", handleMediaChange);
			listeners.clear();
		},
		setPreference: (nextPreference) => {
			preference = nextPreference;
			publish();
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}
