import { useAtomValue } from "@effect/atom-react";
import { Effect } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { usePathname } from "expo-router";
import { useEffect, useEffectEvent } from "react";

import { CLOUD_URL } from "@/api/origin";
import { systemConfigAtom } from "@/modules/server/atoms";
import { useServerUrl } from "@/modules/server/state";

import { sendUmamiEvent } from "./tracker";

const useUmamiSettings = () => {
	const serverUrl = useServerUrl();
	const config = useAtomValue(systemConfigAtom(serverUrl ?? CLOUD_URL));
	if (serverUrl === null || !AsyncResult.isSuccess(config)) {
		return undefined;
	}
	return config.value.analytics.umami;
};

export const useTrackEvent = () => {
	const pathname = usePathname();
	const serverUrl = useServerUrl();
	const settings = useUmamiSettings();

	return useEffectEvent((name: string, data?: Record<string, unknown>) => {
		if (serverUrl === null || settings === undefined) {
			return;
		}
		Effect.runFork(sendUmamiEvent({ serverUrl, settings, event: { name, data, url: pathname } }));
	});
};

export const useTrackPageViews = () => {
	const pathname = usePathname();
	const serverUrl = useServerUrl();
	const settings = useUmamiSettings();

	const trackPageView = useEffectEvent(() => {
		if (serverUrl === null || settings === undefined) {
			return;
		}
		Effect.runFork(sendUmamiEvent({ serverUrl, settings, event: { url: pathname } }));
	});

	// Depend on the settings values rather than their identity so refreshing the
	// system config does not replay a page view for the current route.
	useEffect(() => {
		trackPageView();
	}, [pathname, settings?.hostUrl, settings?.websiteId]);
};
