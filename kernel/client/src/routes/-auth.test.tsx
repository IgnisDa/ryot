import { describe, expect, it } from "@effect/vitest";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime } from "effect";

import type { ServerOrigin } from "#/api/origin";
import { KernelApiTestLayer } from "#/api/ports.test-layer";
import type { OAuthLaunchPlan } from "#/modules/auth/oauth-launcher";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/events.test-layer";
import {
	makePluginCatalog,
	makePluginOperations,
	makePluginQueries,
	makePluginStorage,
} from "#/modules/plugins/services.test-layer";
import { getRouter } from "#/router";
import {
	theme,
	server,
	catalog,
	ServerStub,
	makeAuthStub,
	unauthenticated,
	makePublicApiStub,
	makeStorageStubLayer,
	GodModeRouteStubs,
	CustomizeRouteStubs,
	SavedViewRouteStubs,
	EntityRouteStubs,
	makeOAuthRouteStubs,
	NavigationRouteStubs,
	ProviderAddRouteStubs,
	ImportsRouteStubs,
	IntegrationRouteStubs,
	ClientPagesApiRouteStubs,
	ClientPageSessionsRouteStubs,
	NotificationChannelRouteStubs,
} from "#/routes/-route-fixtures";

const makePlan = (nativeApplicationId: OAuthLaunchPlan["client"]["nativeApplicationId"]) => {
	const callbackUri = nativeApplicationId
		? `${nativeApplicationId}:/auth/callback`
		: `${server}/auth/callback`;
	const clientId = nativeApplicationId ? "ryot-native" : "ryot-web";
	return {
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
			GodModeRouteStubs,
			ServerStub,
			SavedViewRouteStubs,
			EntityRouteStubs,
			makePublicApiStub(),
			makePluginCatalog(catalog),
			NavigationRouteStubs,
			CustomizeRouteStubs,
			makePluginQueries(),
			makePluginStorage(),
			makePluginOperations(),
			makePluginCatalogEventsTestLayer().layer,
			KernelApiTestLayer,
			ClientPagesApiRouteStubs,
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
