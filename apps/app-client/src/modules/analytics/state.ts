import { useAtomValue } from "@effect/atom-react";
import { Effect } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { usePathname } from "expo-router";
import { useEffect, useEffectEvent } from "react";

import { CLOUD_URL } from "@/api/origin";
import { useAuthClient } from "@/modules/auth/client";
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

// Umami keys a user by `payload.id`, which it stores as the distinct ID. The
// account identifier is opaque and stable across sessions and devices, which is
// what makes the same person recognisable on web and native.
const useDistinctId = () => {
	const { data: session } = useAuthClient().useSession();
	return session?.user.id;
};

const useAnalyticsContext = () => {
	const pathname = usePathname();
	const serverUrl = useServerUrl();
	const distinctId = useDistinctId();
	const settings = useUmamiSettings();
	return { pathname, serverUrl, settings, distinctId };
};

export const useTrackEvent = () => {
	const { pathname, serverUrl, settings, distinctId } = useAnalyticsContext();

	return useEffectEvent((name: string, data?: Record<string, unknown>) => {
		if (serverUrl === null || settings === undefined) {
			return;
		}
		Effect.runFork(
			sendUmamiEvent({
				settings,
				serverUrl,
				distinctId,
				event: { name, data, url: pathname },
			}),
		);
	});
};

export const useTrackPageViews = () => {
	const { pathname, serverUrl, settings, distinctId } = useAnalyticsContext();

	const trackPageView = useEffectEvent(() => {
		if (serverUrl === null || settings === undefined) {
			return;
		}
		Effect.runFork(sendUmamiEvent({ serverUrl, settings, distinctId, event: { url: pathname } }));
	});

	// Depend on the settings values rather than their identity so refreshing the
	// system config does not replay a page view for the current route.
	useEffect(() => {
		trackPageView();
	}, [pathname, settings?.hostUrl, settings?.websiteId]);
};

export const useIdentifyUser = () => {
	const { pathname, serverUrl, settings, distinctId } = useAnalyticsContext();

	const identify = useEffectEvent(() => {
		if (serverUrl === null || settings === undefined || distinctId === undefined) {
			return;
		}
		Effect.runFork(
			sendUmamiEvent({
				settings,
				serverUrl,
				distinctId,
				type: "identify",
				event: { url: pathname },
			}),
		);
	});

	// Identifying links the session to the account, so it only needs to run when
	// the account or the receiving instance changes, not on every navigation.
	useEffect(() => {
		identify();
	}, [distinctId, settings?.hostUrl, settings?.websiteId]);
};
