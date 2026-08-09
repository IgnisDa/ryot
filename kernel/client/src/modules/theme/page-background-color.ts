import type { useColorScheme } from "react-native";

import type { ThemePreference } from "./atoms";

const PAGE_BACKGROUND_COLOR = { light: "#f5f2ec", dark: "#101113" } as const;

export const pageBackgroundColor = (
	preference: ThemePreference,
	systemScheme: ReturnType<typeof useColorScheme>,
) => {
	const scheme = preference === "system" ? systemScheme : preference;
	return PAGE_BACKGROUND_COLOR[scheme === "dark" ? "dark" : "light"];
};

export const withPageAlpha = (color: string, alpha: number) =>
	`${color}${Math.round(alpha * 255)
		.toString(16)
		.padStart(2, "0")}`;
