import { parseServerOrigin, type ServerOrigin } from "../api/origin";
import { isThemePreference, type ThemePreference } from "../modules/theme/preference";

export const RYOT_STORAGE_PREFIX = "ryot:";
export const THEME_PREFERENCE_KEY = `${RYOT_STORAGE_PREFIX}theme`;
export const SERVER_SELECTION_KEY = `${RYOT_STORAGE_PREFIX}server-url`;

export type BrowserStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

const browserStorage = () => (typeof localStorage === "undefined" ? undefined : localStorage);

export const getServerSelection = (
	storage: BrowserStorage | undefined = browserStorage(),
): ServerOrigin | null => {
	const value = storage?.getItem(SERVER_SELECTION_KEY);
	if (value === null || value === undefined) {
		return null;
	}
	const result = parseServerOrigin(value);
	return result.ok ? result.origin : null;
};

export const setServerSelection = (
	origin: ServerOrigin,
	storage: BrowserStorage | undefined = browserStorage(),
) => storage?.setItem(SERVER_SELECTION_KEY, origin);

export const clearServerSelection = (storage: BrowserStorage | undefined = browserStorage()) =>
	storage?.removeItem(SERVER_SELECTION_KEY);

export const getThemePreference = (
	storage: BrowserStorage | undefined = browserStorage(),
): ThemePreference => {
	const value = storage?.getItem(THEME_PREFERENCE_KEY);
	return isThemePreference(value) ? value : "system";
};

export const setThemePreference = (
	preference: ThemePreference,
	storage: BrowserStorage | undefined = browserStorage(),
) => storage?.setItem(THEME_PREFERENCE_KEY, preference);
