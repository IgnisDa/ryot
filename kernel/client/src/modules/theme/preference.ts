export const THEME_PREFERENCES = ["light", "dark", "system"] as const;

export type ResolvedTheme = Exclude<ThemePreference, "system">;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export interface ThemeRoot {
	removeAttribute(name: string): void;
	setAttribute(name: string, value: string): void;
}

export const isThemePreference = (value: unknown): value is ThemePreference =>
	typeof value === "string" && THEME_PREFERENCES.some((preference) => preference === value);

export const resolveTheme = (
	preference: ThemePreference,
	systemTheme: ResolvedTheme,
): ResolvedTheme => (preference === "system" ? systemTheme : preference);

export function applyThemePreference(root: ThemeRoot, preference: ThemePreference) {
	if (preference === "system") {
		root.removeAttribute("data-theme");
	} else {
		root.setAttribute("data-theme", preference);
	}
}
