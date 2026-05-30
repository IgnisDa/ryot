import {
	REQUIRED_THEME_TOKEN_NAMES,
	type PluginThemeSnapshot,
} from "@ryot/contract/modules/plugins/client";
import { describe, expect, it } from "vitest";

import { createThemeStore } from "#/modules/theme/store";

function setup(matches: boolean, initial: "light" | "dark" | "system" = "system") {
	const attributes = new Map<string, string>();
	const mediaListeners = new Set<() => void>();
	const media = {
		matches,
		addEventListener: (_type: "change", listener: () => void) => mediaListeners.add(listener),
		removeEventListener: (_type: "change", listener: () => void) => mediaListeners.delete(listener),
	};
	const root = {
		removeAttribute: (name: string) => attributes.delete(name),
		setAttribute: (name: string, value: string) => attributes.set(name, value),
	};
	const store = createThemeStore(initial, {
		media,
		root,
		getStyle: () => ({
			getPropertyValue: (name) =>
				`${attributes.get("data-theme") ?? (media.matches ? "dark" : "light")}-${name.slice(2)}`,
		}),
	});
	return {
		media,
		store,
		attributes,
		changeMedia: (next: boolean) => {
			media.matches = next;
			for (const listener of mediaListeners) {
				listener();
			}
		},
		mediaListeners,
	};
}

describe("theme store", () => {
	it("resolves light, dark, and system snapshots from the applied kernel palette", () => {
		const { attributes, store } = setup(false);

		expect(store.getSnapshot().resolvedMode).toBe("light");
		expect(attributes.has("data-theme")).toBe(false);
		store.setPreference("dark");
		expect(store.getSnapshot().resolvedMode).toBe("dark");
		expect(attributes.get("data-theme")).toBe("dark");
		store.setPreference("light");
		expect(store.getSnapshot().resolvedMode).toBe("light");
		expect(attributes.get("data-theme")).toBe("light");
	});

	it("extracts every required semantic token from computed style", () => {
		const { store } = setup(false, "light");
		const snapshot = store.getSnapshot();

		expect(Object.keys(snapshot.tokens)).toEqual([...REQUIRED_THEME_TOKEN_NAMES]);
		expect(snapshot.tokens).toEqual(
			Object.fromEntries(REQUIRED_THEME_TOKEN_NAMES.map((name) => [name, `light-${name}`])),
		);
	});

	it("rejects a missing required computed token", () => {
		expect(() =>
			createThemeStore("light", {
				media: {
					matches: false,
					addEventListener: () => undefined,
					removeEventListener: () => undefined,
				},
				root: { removeAttribute: () => undefined, setAttribute: () => undefined },
				getStyle: () => ({ getPropertyValue: () => "" }),
			}),
		).toThrow();
	});

	it("publishes media changes only for system preference and cleans up", () => {
		const { changeMedia, mediaListeners, store } = setup(false);
		const snapshots: PluginThemeSnapshot[] = [];
		const unsubscribe = store.subscribe(() => snapshots.push(store.getSnapshot()));

		changeMedia(true);
		expect(snapshots.map(({ resolvedMode }) => resolvedMode)).toEqual(["dark"]);
		store.setPreference("light");
		changeMedia(false);
		expect(snapshots.map(({ resolvedMode }) => resolvedMode)).toEqual(["dark", "light"]);
		store.setPreference("system");
		changeMedia(true);
		expect(snapshots.map(({ resolvedMode }) => resolvedMode)).toEqual([
			"dark",
			"light",
			"light",
			"dark",
		]);

		unsubscribe();
		store.destroy();
		expect(mediaListeners.size).toBe(0);
	});
});
