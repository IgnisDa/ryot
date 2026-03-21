import { useComputedColorScheme } from "@mantine/core";

export function useColorScheme() {
	return useComputedColorScheme("light", { getInitialValueInEffect: false });
}

export function useThemeTokens() {
	const isDark = useColorScheme() === "dark";
	return {
		isDark,
		surface: isDark ? "var(--mantine-color-dark-8)" : "white",
		surfaceHover: isDark
			? "var(--mantine-color-dark-7)"
			: "var(--mantine-color-stone-1)",
		border: isDark
			? "var(--mantine-color-dark-6)"
			: "var(--mantine-color-stone-3)",
		textPrimary: isDark
			? "var(--mantine-color-dark-0)"
			: "var(--mantine-color-dark-9)",
		textMuted: isDark
			? "var(--mantine-color-dark-4)"
			: "var(--mantine-color-stone-5)",
		textSecondary: isDark
			? "var(--mantine-color-dark-2)"
			: "var(--mantine-color-dark-6)",
		textLink: isDark
			? "var(--mantine-color-dark-1)"
			: "var(--mantine-color-dark-7)",
	};
}
