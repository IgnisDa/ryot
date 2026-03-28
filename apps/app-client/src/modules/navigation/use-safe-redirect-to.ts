import { useLocalSearchParams } from "expo-router";

import { getSafeRedirectTo } from "@/modules/navigation/redirect";

type RedirectToParams = { redirectTo?: string | string[] };

export function useSafeRedirectTo() {
	const { redirectTo } = useLocalSearchParams<RedirectToParams>();
	return getSafeRedirectTo(redirectTo);
}
