import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";
import { Appearance, Platform } from "react-native";

import { themeAtom } from "@/api/atoms";

export function ThemeController() {
	const theme = useAtomValue(themeAtom);

	useEffect(() => {
		if (Platform.OS === "web") {
			if (theme === "system") {
				document.documentElement.removeAttribute("data-theme");
			} else {
				document.documentElement.dataset.theme = theme;
			}
		} else {
			Appearance.setColorScheme(theme === "system" ? "unspecified" : theme);
		}
	}, [theme]);

	return null;
}
