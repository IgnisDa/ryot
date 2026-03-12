import { useMediaQuery } from "@mantine/hooks";

export function useIsMobileScreen() {
	return useMediaQuery("(max-width: 767px)");
}
