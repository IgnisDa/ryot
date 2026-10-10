import { describe, expect, it } from "@effect/vitest";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime } from "effect";

import type { ServerOrigin } from "#/api/origin";
import { KernelApiTestLayer } from "#/api/ports.test-layer";
import type { OAuthLaunchPlan } from "#/modules/auth/oauth-launcher";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import { pluginBridgeServicesTestLayer } from "#/modules/pages/bridge/services.test-layer";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/catalog/events.test-layer";
import { makePluginCatalog } from "#/modules/plugins/catalog/service.test-layer";
import { getRouter } from "#/router";
import {
	catalog,
	ClientPageSessionsRouteStubs,
	CustomizeRouteStubs,
	DeviceRouteStubs,
	EntityRouteStubs,
	ImportsRouteStubs,
	InstanceAdminRouteStubs,
	IntegrationRouteStubs,
	makeAuthStub,
	makeOAuthRouteStubs,
	makePublicApiStub,
	makeStorageStubLayer,
	NavigationRouteStubs,
	NotificationChannelRouteStubs,
	PagesApiRouteStubs,
	ProviderAddRouteStubs,
	SavedViewRouteStubs,
	server,
	ServerStub,
	theme,
	unauthenticated,
} from "#/routes/-route-fixtures";

const makePlan = (nativeApplicationId: OAuthLaunchPlan["client"]["nativeApplicationId"]) => {
	const callbackUri = nativeApplicationId
		? `${nativeApplicationId}:/auth/callback`
		: `${server}/auth/callback`;
	const clientId = nativeApplicationId ? "ryot-native" : "ryot-web";
	return {
		codeChallenge: "challenge",
		authorizationUrl: `${server}/api/auth/oauth2/authorize`,
		client: {
			clientId,
			callbackUri,
			nativeApplicationId,
			logoutUri: `${server}/auth/logout/callback`,
		},
		pending: {
			clientId,
			createdAt: 1,
			state: "state",
			nonce: "nonce",
			destination: "/",
			serverOrigin: server,
			codeVerifier: "verifier",
			redirectUri: callbackUri,
		},
	} satisfies OAuthLaunchPlan;
};

const mountAuth = (plan: OAuthLaunchPlan) => {
	const launched: OAuthLaunchPlan[] = [];
	const changedServers: (ServerOrigin | null)[] = [];
	const oauth = makeOAuthRouteStubs(
		{},
		{},
		{ isNative: plan.client.nativeApplicationId !== null },
		{
			launch: (target) => Effect.sync(() => launched.push(target)),
			prepare: () => Effect.succeed({ plan, _tag: "Ready" } as const),
		},
	);
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProviderAddRouteStubs,
			ImportsRouteStubs,
			IntegrationRouteStubs,
			NotificationChannelRouteStubs,
			makeAuthStub(
				{ changeServer: (origin) => Effect.sync(() => changedServers.push(origin)) },
				unauthenticated,
			),
			InstanceAdminRouteStubs,
			ServerStub,
			SavedViewRouteStubs,
			EntityRouteStubs,
			makePublicApiStub(),
			makePluginCatalog(catalog),
			DeviceRouteStubs,
			NavigationRouteStubs,
			CustomizeRouteStubs,
			pluginBridgeServicesTestLayer,
			makePluginCatalogEventsTestLayer().layer,
			KernelApiTestLayer,
			PagesApiRouteStubs,
			ClientPageSessionsRouteStubs,
		).pipe(Layer.provideMerge(oauth), Layer.provideMerge(makeStorageStubLayer())),
	);
	const router = getRouter(
		{ theme, runtime, backInterceptors: createBackInterceptors() },
		createMemoryHistory({ initialEntries: ["/auth"] }),
	);
	render(<RouterProvider router={router} />);
	return { launched, changedServers };
};

describe("OAuth launch", () => {
	it.live("opens web sign-in without waiting for the user", () =>
		Effect.gen(function* () {
			const plan = makePlan(null);
			const mounted = mountAuth(plan);

			yield* Effect.promise(() => screen.findByRole("heading", { name: "Opening sign-in" }));
			yield* Effect.promise(() => waitFor(() => expect(mounted.launched).toEqual([plan])));
			expect(screen.queryByRole("button", { name: "Change server" })).toBeNull();
		}),
	);

	it.live("waits for a native tap before opening sign-in", () =>
		Effect.gen(function* () {
			const plan = makePlan("io.ryot.app.dev");
			const mounted = mountAuth(plan);

			yield* Effect.promise(() => screen.findByRole("heading", { name: "Sign in to Ryot" }));
			expect(screen.getByText("Continue with ryot.example.")).not.toBeNull();
			expect(mounted.launched).toEqual([]);

			fireEvent.click(screen.getByRole("button", { name: "Continue to sign in" }));
			yield* Effect.promise(() => waitFor(() => expect(mounted.launched).toEqual([plan])));
		}),
	);

	it.live("lets a native user change server before signing in", () =>
		Effect.gen(function* () {
			const mounted = mountAuth(makePlan("io.ryot.app.dev"));

			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Change server" })),
			);
			yield* Effect.promise(() => waitFor(() => expect(mounted.changedServers).toEqual([server])));
			expect(mounted.launched).toEqual([]);
		}),
	);
});
