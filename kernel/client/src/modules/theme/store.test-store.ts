import type { ThemePreference } from "#/modules/theme/preference";
import type { ThemeStore } from "#/modules/theme/store";

export const makeTestThemeStore = (initial: ThemePreference): ThemeStore => {
	const listeners = new Set<() => void>();
	let preference = initial;
	return {
		destroy: () => undefined,
		getPreference: () => preference,
		getSnapshot: () => {
			throw new Error("not used");
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		setPreference: (next) => {
			preference = next;
			for (const listener of listeners) {
				listener();
			}
		},
	};
};
