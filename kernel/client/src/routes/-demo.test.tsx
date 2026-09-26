import { describe, expect, it } from "@effect/vitest";
import type { AccessClass } from "@ryot-app/contract/oauth";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime } from "effect";

import { KernelApiTestLayer } from "#/api/ports.test-layer";
import { HostedAuthError } from "#/modules/auth/hosted-service";
import type { ExplicitOAuthClientDescriptor, OAuthLaunchPlan } from "#/modules/auth/oauth-launcher";
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
	ServerStub,
	unauthenticated,
	makeAuthStub,
	makeStorageStubLayer,
	GodModeRouteStubs,
	makePublicApiStub,
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

const authenticated = (accessClass: AccessClass) => ({
	accessClass,
	status: "authenticated" as const,
	user: { image: null, id: "user-1", name: "Test User", email: "user@ryot.example" },
});

const mountDemo = (
	options: {
		readonly accessClass?: AccessClass;
		readonly failHosted?: boolean;
		readonly mode?: "demo" | "standard";
		readonly native?: boolean;
	} = {},
) => {
	let hostedCalls = 0;
	const prepared: Array<ExplicitOAuthClientDescriptor | undefined> = [];
	const launched: OAuthLaunchPlan[] = [];
	const oauth = makeOAuthRouteStubs(
		{},
		{
			signInDemo: Effect.suspend(() => {
				hostedCalls += 1;
				return options.failHosted
					? Effect.fail(new HostedAuthError({ message: "sensitive server detail" }))
					: Effect.succeed({ mode: options.mode ?? "demo" });
			}),
		},
		{ isNative: options.native ?? false },
		{
			launch: (plan) => Effect.sync(() => launched.push(plan)),
			prepare: (_redirect, explicit) => {
				prepared.push(explicit);
				const client = explicit?.client ?? {
					nativeApplicationId: null,
					clientId: "ryot-web" as const,
					callbackUri: `${server}/auth/callback`,
					logoutUri: `${server}/auth/logout/callback`,
				};
				return Effect.succeed({
					_tag: "Ready" as const,
					plan: {
						client,
						codeChallenge: "challenge",
						authorizationUrl: `${server}/api/auth/oauth2/authorize`,
						pending: {
							createdAt: 1,
							state: "state",
							nonce: "nonce",
							destination: "/",
							codeVerifier: "verifier",
							clientId: client.clientId,
							redirectUri: client.callbackUri,
							serverOrigin: explicit?.serverOrigin ?? server,
						},
					},
				});
			},
		},
	);
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProviderAddRouteStubs,
			ImportsRouteStubs,
			IntegrationRouteStubs,
			NotificationChannelRouteStubs,
			makeAuthStub({}, options.accessClass ? authenticated(options.accessClass) : unauthenticated),
			GodModeRouteStubs,
			ServerStub,
			SavedViewRouteStubs,
			EntityRouteStubs,
			makePublicApiStub(),
			makePluginCatalog([]),
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
		createMemoryHistory({ initialEntries: ["/demo"] }),
	);
	render(<RouterProvider router={router} />);
	return { router, launched, prepared, hostedCallCount: () => hostedCalls };
};

describe("demo entry route", () => {
	it.live.each(["standard", "demo"] as const)(
		"keeps an existing %s application session",
		(accessClass) =>
			Effect.gen(function* () {
				const mounted = mountDemo({ accessClass });

				yield* Effect.promise(() =>
					waitFor(() => expect(mounted.router.state.location.pathname).toBe("/")),
				);
				expect(mounted.hostedCallCount()).toBe(0);
				expect(mounted.prepared).toEqual([]);
			}),
	);

	it.live.each([
		["demo", "ryot-demo-web"],
		["standard", "ryot-web"],
	] as const)("uses the %s hosted mode to launch %s", ([mode, clientId]) =>
		Effect.gen(function* () {
			const mounted = mountDemo({ mode });

			yield* Effect.promise(() => waitFor(() => expect(mounted.launched).toHaveLength(1)));
			expect(mounted.hostedCallCount()).toBe(1);
			expect(mounted.prepared).toHaveLength(1);
			expect(mounted.prepared[0]?.client).toMatchObject({
				clientId,
				nativeApplicationId: null,
				callbackUri: `${window.location.origin}/auth/callback`,
			});
			expect(mounted.launched[0]?.client.clientId).toBe(clientId);
		}),
	);

	it.live("shows the dedicated unavailable state for a rejected hosted request", () =>
		Effect.gen(function* () {
			mountDemo({ failHosted: true });

			yield* Effect.promise(() => screen.findByText("Demo unavailable"));
			expect(
				screen.getByText("The shared demo account is not available on this server."),
			).not.toBeNull();
			expect(screen.queryByText("sensitive server detail")).toBeNull();
		}),
	);

	it.live("routes native invocation through ordinary authentication", () =>
		Effect.gen(function* () {
			const mounted = mountDemo({ native: true });

			yield* Effect.promise(() =>
				waitFor(() => expect(mounted.router.state.location.pathname).toBe("/auth")),
			);
			expect(mounted.hostedCallCount()).toBe(0);
			expect(mounted.prepared).toEqual([undefined]);
		}),
	);
});
