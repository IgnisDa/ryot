import { describe, expect, it } from "@effect/vitest";
import { OAuthConnectionId } from "@ryot-app/contract/schema/brands";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime } from "effect";

import { KernelApiTestLayer, makeOAuthConnectionsApi } from "#/api/ports.test-layer";
import type { AuthService } from "#/modules/auth/service";
import {
	captureOAuthReturnFragment,
	makeOAuthReturnCapture,
	OAuthReturnCapture,
} from "#/modules/integrations/oauth-return";
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
	catalog,
	ServerStub,
	makeAuthStub,
	unauthenticated,
	makeOAuthRouteStubs,
	makeStorageStubLayer,
	ImportsRouteStubs,
	GodModeRouteStubs,
	makePublicApiStub,
	CustomizeRouteStubs,
	SavedViewRouteStubs,
	EntityRouteStubs,
	NavigationRouteStubs,
	ProviderAddRouteStubs,
	IntegrationRouteStubs,
	NotificationChannelRouteStubs,
	makeUserSettingsStub,
	ClientPagesApiRouteStubs,
	ClientPageSessionsRouteStubs,
} from "#/routes/-route-fixtures";

const RETURN_PATH = "/settings/oauth-return";

const captureFrom = (hash: string) => {
	const replaced: string[] = [];
	const fragment = captureOAuthReturnFragment(
		{ hash, search: "", pathname: RETURN_PATH },
		{ state: null, replaceState: (_state, _unused, url) => void replaced.push(String(url)) },
	);
	return { fragment, entry: replaced.at(-1) ?? RETURN_PATH };
};

const mountReturn = (
	hash: string,
	options: { readonly auth?: Layer.Layer<AuthService>; readonly destinations?: unknown[] } = {},
) => {
	const closed: string[] = [];
	const completes: { readonly connectionId: string; readonly secret: string }[] = [];
	const capture = makeOAuthReturnCapture(() => void closed.push("closed"));
	const { entry, fragment } = captureFrom(hash);
	const events = makePluginCatalogEventsTestLayer();
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProviderAddRouteStubs,
			ImportsRouteStubs,
			IntegrationRouteStubs,
			NotificationChannelRouteStubs,
			options.auth ?? makeAuthStub(),
			GodModeRouteStubs,
			ServerStub,
			SavedViewRouteStubs,
			EntityRouteStubs,
			makePublicApiStub(),
			KernelApiTestLayer,
			ClientPagesApiRouteStubs,
			ClientPageSessionsRouteStubs,
			makeUserSettingsStub(),
			events.layer,
			makePluginCatalog(catalog),
			NavigationRouteStubs,
			CustomizeRouteStubs,
			makePluginOperations(),
			makePluginQueries(),
			makePluginStorage(),
			makeOAuthConnectionsApi({
				complete: (_scope, request) =>
					Effect.sync(() => {
						completes.push({
							secret: request.payload.secret,
							connectionId: request.params.connectionId,
						});
						return { id: request.params.connectionId };
					}),
			}),
		).pipe(
			Layer.provideMerge(Layer.succeed(OAuthReturnCapture, capture)),
			Layer.provideMerge(
				makeOAuthRouteStubs(
					{},
					{},
					{},
					{
						prepare: (destination) =>
							Effect.sync(() => void options.destinations?.push(destination)).pipe(
								Effect.andThen(Effect.die("sign-in not under test")),
							),
					},
				),
			),
			Layer.provideMerge(makeStorageStubLayer("fixture")),
		),
	);
	runtime.runSync(capture.record(fragment));
	const router = getRouter(
		{ theme, runtime, backInterceptors: createBackInterceptors() },
		createMemoryHistory({ initialEntries: [entry] }),
	);
	const view = render(<RouterProvider router={router} />);
	return { ...view, entry, router, closed, completes };
};

describe("OAuth connection return route", () => {
	it.live("completes a captured connection exactly once across remounts", () =>
		Effect.gen(function* () {
			const mounted = mountReturn("#connection=connection-1&secret=secret-1");
			expect(mounted.entry).toBe(RETURN_PATH);

			yield* Effect.promise(() => screen.findByText("Connected — you can close this window."));
			expect(mounted.completes).toEqual([
				{ secret: "secret-1", connectionId: OAuthConnectionId.make("connection-1") },
			]);
			expect(mounted.closed).toEqual(["closed"]);

			yield* Effect.promise(() => mounted.router.navigate({ to: "/settings/about" }));
			yield* Effect.promise(() => mounted.router.navigate({ to: RETURN_PATH }));

			yield* Effect.promise(() => screen.findByText("Nothing to connect"));
			expect(mounted.completes).toHaveLength(1);
			expect(mounted.closed).toEqual(["closed"]);
		}),
	);

	it.live("shows a failed return without completing anything", () =>
		Effect.gen(function* () {
			const mounted = mountReturn("#connection=connection-1&status=failed");

			const alert = yield* Effect.promise(() => screen.findByRole("alert"));
			expect(alert.textContent).toBe(
				"The account could not be connected. Close this window and try again.",
			);
			expect(screen.getByText("Couldn't connect")).toBeTruthy();
			yield* Effect.promise(() => waitFor(() => expect(mounted.closed).toEqual(["closed"])));
			expect(mounted.completes).toEqual([]);
		}),
	);

	it.live("explains a visit without a captured return", () =>
		Effect.gen(function* () {
			const mounted = mountReturn("");

			yield* Effect.promise(() => screen.findByText("Nothing to connect"));
			expect(mounted.completes).toEqual([]);
			expect(mounted.closed).toEqual([]);
		}),
	);

	it.live("sends a signed-out return visit to sign-in without the secret", () =>
		Effect.gen(function* () {
			const destinations: unknown[] = [];
			const mounted = mountReturn("#connection=connection-1&secret=secret-1", {
				destinations,
				auth: makeAuthStub({}, unauthenticated),
			});

			yield* Effect.promise(() =>
				waitFor(() => expect(mounted.router.state.location.pathname).toBe("/auth")),
			);
			expect(mounted.router.state.location.search).toEqual({ redirect: RETURN_PATH });
			expect(mounted.router.state.location.href).not.toContain("secret");
			expect(destinations).toEqual([RETURN_PATH]);
			expect(mounted.completes).toEqual([]);
		}),
	);
});
