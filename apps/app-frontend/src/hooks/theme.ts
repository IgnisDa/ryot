import { useComputedColorScheme } from "@mantine/core";

export function useColorScheme() {
	return useComputedColorScheme("light", { getInitialValueInEffect: false });
}
