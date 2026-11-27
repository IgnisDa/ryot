import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import type { ManagedRuntime } from "effect";
import { useLayoutEffect } from "react";

import type { ApiScope } from "#/api/scope";
import { IosLiveActivitiesService } from "#/modules/ios-live-activities/service";

export function IosLiveActivityScope(props: {
	readonly scope: ApiScope;
	readonly catalog: PluginClientCatalog;
	readonly runtime: ManagedRuntime.ManagedRuntime<IosLiveActivitiesService, never>;
}) {
	const { userId, serverUrl } = props.scope;
	useLayoutEffect(() => {
		props.runtime.runFork(
			props.runtime
				.runSync(IosLiveActivitiesService)
				.setScope({ userId, serverUrl }, props.catalog),
		);
	}, [props.runtime, props.catalog, serverUrl, userId]);
	useLayoutEffect(
		() => () => {
			props.runtime.runFork(
				props.runtime.runSync(IosLiveActivitiesService).clearScope({ userId, serverUrl }),
			);
		},
		[props.runtime, serverUrl, userId],
	);
	return null;
}
