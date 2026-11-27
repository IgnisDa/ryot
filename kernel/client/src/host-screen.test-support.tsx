import type { Entitlements } from "@ryot-app/contract/schema/entitlement";
import type { PluginBridgeCatalog } from "@ryot-app/plugin-client-contract";
import type { RyotClientAdapter, RyotClientError } from "@ryot-app/plugin-client-sdk";
import { RyotProvider } from "@ryot-app/plugin-client-sdk/react";
import { createTestRyotClock } from "@ryot-app/plugin-client-sdk/testing";
import { OverlayBackProvider } from "@ryot-app/plugin-ui-sdk";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { Effect, type Layer, ManagedRuntime } from "effect";
import { type ReactNode, StrictMode } from "react";

import { ServerOrigin } from "#/api/origin";
import { testHostServices } from "#/host-services.test-support";
import { EntitlementsProvider } from "#/modules/entitlements/context";
import { TestKernelI18nProvider } from "#/modules/i18n/provider.test-support";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";

export type HostedTestQueryRequest = Parameters<RyotClientAdapter["query"]>[0];

export const mountHostedTestScreen = <Services,>(
	content: ReactNode,
	options: {
		readonly strict?: boolean;
		readonly onRootLoad?: () => void;
		readonly serverUrl?: ServerOrigin;
		readonly entitlements?: Entitlements;
		readonly layer: Layer.Layer<Services>;
		readonly catalogs?: readonly PluginBridgeCatalog[];
		readonly routes?: Readonly<Record<string, ReactNode>>;
		readonly query: (document: HostedTestQueryRequest) => Effect.Effect<unknown, RyotClientError>;
	},
) => {
	const runtime = ManagedRuntime.make(options.layer);
	const clock = createTestRyotClock({ query: options.query });
	const root = createRootRoute({ component: Outlet, loader: options.onRootLoad });
	const main = createRoute({ path: "/", component: () => content, getParentRoute: () => root });
	const routes = Object.entries(options.routes ?? {}).map(([path, element]) =>
		createRoute({ path, component: () => element, getParentRoute: () => root }),
	);
	const router = createRouter({
		routeTree: root.addChildren([main, ...routes]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	const backInterceptors = createBackInterceptors();
	const screen = (
		<OverlayBackProvider adapter={backInterceptors}>
			<RyotProvider
				runtime={clock.runtime}
				hostServices={testHostServices(
					{
						userId: "user-1",
						serverUrl: options.serverUrl ?? ServerOrigin.make("https://example.test"),
					},
					runtime,
				)}
			>
				<TestKernelI18nProvider catalogs={options.catalogs}>
					<EntitlementsProvider entitlements={options.entitlements ?? ["pro"]}>
						<RouterProvider router={router} />
					</EntitlementsProvider>
				</TestKernelI18nProvider>
			</RyotProvider>
		</OverlayBackProvider>
	);
	const view = render(options.strict === true ? <StrictMode>{screen}</StrictMode> : screen);
	return {
		router,
		backInterceptors,
		advance: clock.advance,
		dispose: () => {
			view.unmount();
			return Effect.runPromise(Effect.all([runtime.disposeEffect, Effect.promise(clock.dispose)]));
		},
	};
};
