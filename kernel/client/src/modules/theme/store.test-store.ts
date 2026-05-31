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
		setPreference: (next) => {
			preference = next;
			for (const listener of listeners) {
				listener();
			}
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
};
