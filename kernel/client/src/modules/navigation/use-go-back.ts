import { useRouter } from "expo-router";

import { getWorkspaceHref } from "./navigation-data";

export function useGoBack() {
	const router = useRouter();
	return () => {
		if (router.canGoBack()) {
			router.back();
			return;
		}
		router.replace(getWorkspaceHref());
	};
}
