import { RegistryProvider } from "@effect/atom-react";
import type { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { OverlayBackProvider } from "@ryot-app/plugin-ui-sdk";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
	createContext,
	useEffect,
	useContext,
	useMemo,
	useSyncExternalStore,
	type ReactNode,
} from "react";

import type { RyotClient } from "../client/client";
import type { PluginRouterNavigation } from "../navigation/store";
import {
	createPageRefreshRegistry,
	PageRefreshLifecycle,
	PageRefreshRegistryContext,
} from "../refresh/page-registry";
import { RyotClientService, RyotNavigationService, type RyotRuntime } from "../runtime/runtime";
import { RyotScheduleService, type RyotSchedule } from "../schedule";
import { idleTTL } from "./definitions";

export const RyotContext = createContext<
	| {
			readonly client: RyotClient;
			readonly hostServices: unknown;
			readonly schedule: RyotSchedule;
			readonly navigation: PluginRouterNavigation | undefined;
	  }
	| undefined
>(undefined);

export const usePluginIdentity = (packageId: PluginPackageId) =>
	useRyot().pluginIdentity(packageId);

export const RyotProvider = ({
	runtime,
	children,
	hostServices,
}: {
	children: ReactNode;
	runtime: RyotRuntime;
	readonly hostServices?: unknown;
}) => {
	const runtimeValue = useMemo(
		() =>
			runtime.runSync(
				Effect.all({
					client: RyotClientService,
					schedule: RyotScheduleService,
					// Only a plugin artifact's runtime carries navigation; the kernel host has no router.
					navigation: Effect.map(
						Effect.serviceOption(RyotNavigationService),
						Option.getOrUndefined,
					),
				}),
			),
		[runtime],
	);
	const value = useMemo(() => ({ ...runtimeValue, hostServices }), [runtimeValue, hostServices]);
	const refreshRegistry = useMemo(
		() => createPageRefreshRegistry(value.schedule),
		[value.schedule],
	);
	useEffect(() => {
		refreshRegistry.activate();
		const unsubscribe = value.client.mutationCompleted.subscribe(refreshRegistry.hint);
		return () => {
			unsubscribe();
			refreshRegistry.dispose();
		};
	}, [refreshRegistry, value.client]);
	return (
		<RegistryProvider defaultIdleTTL={idleTTL}>
			<RyotContext.Provider value={value}>
				<OverlayBackProvider adapter={value.client.overlayBack}>
					<PageRefreshRegistryContext.Provider value={refreshRegistry}>
						<PageRefreshLifecycle />
						{children}
					</PageRefreshRegistryContext.Provider>
				</OverlayBackProvider>
			</RyotContext.Provider>
		</RegistryProvider>
	);
};

export const useRyot = () => {
	const context = useContext(RyotContext);
	if (!context) {
		throw new Error("useRyot must be used within RyotProvider");
	}
	return context.client;
};

export const useRyotSchedule = (): RyotSchedule => {
	const context = useContext(RyotContext);
	if (!context) {
		throw new Error("useRyotSchedule must be used within RyotProvider");
	}
	return context.schedule;
};

/** SDK-internal: `PluginRouter` only. Not a plugin capability, so it stays off `./plugin`. */
export const usePluginNavigation = (): PluginRouterNavigation => {
	const context = useContext(RyotContext);
	if (!context?.navigation) {
		throw new Error("usePluginNavigation must be used within a plugin artifact RyotProvider");
	}
	return context.navigation;
};

export const useRyotTheme = () => {
	const { theme } = useRyot();
	return useSyncExternalStore(theme.subscribe, theme.getSnapshot, theme.getSnapshot);
};
