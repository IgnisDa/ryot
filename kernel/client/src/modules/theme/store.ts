import {
	PluginThemeSnapshot,
	REQUIRED_THEME_TOKEN_NAMES,
} from "@ryot-app/contract/modules/plugins/client";
import { Schema } from "effect";

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

type ThemeStyle = {
	getPropertyValue(name: string): string;
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
		readonly getStyle?: (root: ThemeRoot) => ThemeStyle;
	} = {},
): ThemeStore {
	const root = options.root ?? document.documentElement;
	const media = options.media ?? window.matchMedia("(prefers-color-scheme: dark)");
	const getStyle = options.getStyle ?? (() => window.getComputedStyle(document.documentElement));
	const listeners = new Set<() => void>();
	let preference = initialPreference;
	let snapshot = resolveSnapshot();

	function resolveSnapshot(): PluginThemeSnapshot {
		applyThemePreference(root, preference);
		const style = getStyle(root);
		return Schema.decodeUnknownSync(PluginThemeSnapshot)({
			resolvedMode: resolveTheme(preference, media.matches ? "dark" : "light"),
			tokens: Object.fromEntries(
				REQUIRED_THEME_TOKEN_NAMES.map((name) => [
					name,
					style.getPropertyValue(`--${name}`).trim(),
				]),
			),
		});
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
