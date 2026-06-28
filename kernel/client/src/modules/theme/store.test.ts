import type { PluginThemeSnapshot } from "@ryot-app/client-plugin-contract";
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
	const store = createThemeStore(initial, { root, media });
	return {
		media,
		store,
		attributes,
		mediaListeners,
		changeMedia: (next: boolean) => {
			media.matches = next;
			for (const listener of mediaListeners) {
				listener();
			}
		},
	};
}

describe("theme store", () => {
	it("resolves light, dark, and system snapshots from the applied kernel palette", () => {
		const { store, attributes } = setup(false);

		expect(store.getSnapshot().resolvedMode).toBe("light");
		expect(attributes.has("data-theme")).toBe(false);
		store.setPreference("dark");
		expect(store.getSnapshot().resolvedMode).toBe("dark");
		expect(attributes.get("data-theme")).toBe("dark");
		store.setPreference("light");
		expect(store.getSnapshot().resolvedMode).toBe("light");
		expect(attributes.get("data-theme")).toBe("light");
	});

	it("publishes media changes only for system preference and cleans up", () => {
		const { store, changeMedia, mediaListeners } = setup(false);
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
