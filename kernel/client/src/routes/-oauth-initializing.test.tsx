import { describe, expect, it } from "@effect/vitest";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Deferred, Effect, Layer, ManagedRuntime } from "effect";

import { KernelApiTestLayer } from "#/api/ports.test-layer";
import { HostedAuthError, type HostedAuthService } from "#/modules/auth/hosted-service";
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

const mountInitializing = (overrides: Partial<HostedAuthService["Service"]> = {}) => {
	const oauth = makeOAuthRouteStubs({}, overrides);
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProviderAddRouteStubs,
			ImportsRouteStubs,
			IntegrationRouteStubs,
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
		createMemoryHistory({ initialEntries: ["/oauth/initializing"] }),
	);
	render(<RouterProvider router={router} />);
	return { router };
};

describe("OAuth initialization", () => {
	it.live("renders the pending account state", () =>
		Effect.gen(function* () {
			mountInitializing({ initializationStatus: Effect.never });

			yield* Effect.promise(() => screen.findByRole("heading", { name: "Preparing your account" }));
			expect(
				screen.getByText(
					"Your account is secure. Ryot is preparing your workspace and will continue automatically.",
				),
			).not.toBeNull();
			expect(screen.getByRole("button", { name: "Sign out" })).not.toBeNull();
		}),
	);

	it.live("runs hosted sign-out and navigates to auth after it completes", () =>
		Effect.gen(function* () {
			const gate = Deferred.makeUnsafe<void>();
			let signOuts = 0;
			const { router } = mountInitializing({
				initializationStatus: Effect.never,
				signOutHosted: Effect.sync(() => {
					signOuts += 1;
				}).pipe(Effect.andThen(Deferred.await(gate))),
			});
			yield* Effect.promise(() => screen.findByRole("button", { name: "Sign out" }));

			fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

			const pending = yield* Effect.promise(() =>
				screen.findByRole("button", { name: "Signing out..." }),
			);
			expect(pending.hasAttribute("disabled")).toBe(true);
			expect(signOuts).toBe(1);

			yield* Deferred.succeed(gate, undefined);
			yield* Effect.promise(() =>
				waitFor(() => expect(router.state.location.pathname).toBe("/auth")),
			);
		}),
	);

	it.live("shows an initialization error and lets the user retry", () =>
		Effect.gen(function* () {
			let statusCalls = 0;
			mountInitializing({
				initializationStatus: Effect.suspend(() => {
					statusCalls += 1;
					return statusCalls === 1
						? Effect.fail(new HostedAuthError({ message: "Could not prepare this account." }))
						: Effect.never;
				}),
			});
			yield* Effect.promise(() =>
				screen.findByRole("heading", { name: "Account initialization paused" }),
			);
			expect(screen.getByText("Could not prepare this account.")).not.toBeNull();

			fireEvent.click(screen.getByRole("button", { name: "Try again" }));

			yield* Effect.promise(() => screen.findByRole("heading", { name: "Preparing your account" }));
			yield* Effect.promise(() => waitFor(() => expect(statusCalls).toBe(2)));
			expect(screen.queryByText("Could not prepare this account.")).toBeNull();
		}),
	);

	it.live("continues when initialization is ready", () =>
		Effect.gen(function* () {
			let continuations = 0;
			mountInitializing({
				initializationStatus: Effect.succeed({ status: "ready" }),
				continueAfterInitialization: Effect.sync(() => {
					continuations += 1;
				}),
			});

			yield* Effect.promise(() => screen.findByRole("heading", { name: "Preparing your account" }));
			yield* Effect.promise(() => waitFor(() => expect(continuations).toBe(1)));
		}),
	);
});
