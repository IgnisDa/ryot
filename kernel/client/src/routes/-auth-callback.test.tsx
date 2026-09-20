import { describe, expect, it } from "@effect/vitest";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime } from "effect";

import { KernelApiTestLayer } from "#/api/ports.test-layer";
import { OAuthTokenError } from "#/modules/auth/token-service";
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

type Exchange = {
	readonly code: string;
	readonly state: string;
	readonly origin: string;
	readonly clientIds: readonly string[];
	readonly redirectUri: string;
};

const pending = (destination = "/") => ({
	destination,
	createdAt: 1,
	state: "state",
	nonce: "nonce",
	serverOrigin: server,
	codeVerifier: "verifier",
	clientId: "ryot-web" as const,
	redirectUri: `${server}/auth/callback`,
});

const mountCallback = (
	initialEntry: string | readonly string[],
	options: {
		readonly destination?: string;
		readonly fail?: boolean;
		readonly native?: boolean;
	} = {},
) => {
	const exchanges: Exchange[] = [];
	const rejected: string[] = [];
	const oauth = makeOAuthRouteStubs(
		{
			rejectAuthorization: (_origin, state) =>
				Effect.sync(() => rejected.push(state)).pipe(
					Effect.andThen(Effect.fail(new OAuthTokenError({ reason: "authorization-rejected" }))),
				),
			completeAuthorization: (origin, clientIds, redirectUri, state, code) => {
				exchanges.push({ code, state, origin, clientIds, redirectUri });
				return options.fail
					? Effect.fail(new OAuthTokenError({ reason: "missing-authorization" }))
					: Effect.succeed(pending(options.destination));
			},
		},
		{},
		options.native
			? {
					isNative: true,
					forServer: () =>
						Effect.succeed({
							clientId: "ryot-native",
							nativeApplicationId: "io.ryot.app",
							callbackUri: "io.ryot.app:/auth/callback",
							logoutUri: "io.ryot.app:/auth/logout/callback",
						}),
				}
			: {},
	);
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProviderAddRouteStubs,
			ImportsRouteStubs,
			IntegrationRouteStubs,
			NotificationChannelRouteStubs,
			NotificationChannelRouteStubs,
			makeAuthStub(),
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
		createMemoryHistory({
			initialEntries: typeof initialEntry === "string" ? [initialEntry] : [...initialEntry],
		}),
	);
	render(<RouterProvider router={router} />);
	return { router, rejected, exchanges };
};

const settledPath = (router: ReturnType<typeof mountCallback>["router"]) =>
	Effect.runPromise(
		Effect.map(
			Effect.promise(() =>
				waitFor(() => expect(router.state.location.pathname).not.toBe("/auth/callback")),
			),
			() => router.state.location,
		),
	);

describe("OAuth callback", () => {
	it.live("exchanges the code against the expected web client and drops callback parameters", () =>
		Effect.gen(function* () {
			const { router, exchanges } = mountCallback("/auth/callback?code=code-1&state=state", {
				destination: "/settings",
			});
			const location = yield* Effect.promise(() => settledPath(router));
			expect(exchanges).toEqual([
				{
					code: "code-1",
					state: "state",
					origin: window.location.origin,
					clientIds: ["ryot-web", "ryot-demo-web"],
					redirectUri: `${window.location.origin}/auth/callback`,
				},
			]);
			expect(location.pathname).toBe("/settings");
			expect(location.searchStr).toBe("");
		}),
	);

	it.live("rejects replayed or unknown state", () =>
		Effect.gen(function* () {
			const { router } = mountCallback("/auth/callback?code=code-1&state=spent", { fail: true });
			yield* Effect.promise(() => screen.findByText("Could not complete sign-in"));
			expect(router.state.location.pathname).toBe("/auth/callback");
		}),
	);

	it.live("permits only the native client and registered redirect on native", () =>
		Effect.gen(function* () {
			const { router, exchanges } = mountCallback("/auth/callback?code=code-1&state=state", {
				native: true,
			});
			yield* Effect.promise(() => settledPath(router));
			expect(exchanges).toEqual([
				{
					code: "code-1",
					state: "state",
					origin: server,
					clientIds: ["ryot-native"],
					redirectUri: "io.ryot.app:/auth/callback",
				},
			]);
		}),
	);

	it.live("consumes an authorization error by state", () =>
		Effect.gen(function* () {
			const { rejected } = mountCallback("/auth/callback?error=access_denied&state=state");
			yield* Effect.promise(() => screen.findByText("Could not complete sign-in"));
			expect(rejected).toEqual(["state"]);
		}),
	);

	it.live("replaces the callback history entry", () =>
		Effect.gen(function* () {
			const { router } = mountCallback(["/settings", "/auth/callback?code=code-1&state=state"]);
			yield* Effect.promise(() => settledPath(router));
			expect(router.history.length).toBe(2);
		}),
	);
});
