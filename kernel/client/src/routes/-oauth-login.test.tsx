import { describe, expect, it } from "@effect/vitest";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime } from "effect";

import { KernelApiTestLayer } from "#/api/ports.test-layer";
import { PublicApi } from "#/api/public";
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

const systemConfig = (
	frontendOrigin: string,
	auth: { readonly localAuthDisabled: boolean; readonly oidcEnabled: boolean },
) => ({
	analytics: {},
	frontendOrigin,
	pro: { isServerKeyValidated: false },
	notifications: { smtpEnabled: false },
	auth: { ...auth, signupAllowed: true },
	fileStorage: {
		temporaryUploadProvider: "local" as const,
		preferredPermanentUploadProvider: "local" as const,
	},
});

const mountLogin = (config: ReturnType<typeof systemConfig>) => {
	let authCalls = 0;
	const requestedOrigins: string[] = [];
	const oauth = makeOAuthRouteStubs(
		{},
		{
			signInWithOidc: Effect.sync(() => {
				authCalls += 1;
			}),
		},
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
			Layer.succeed(PublicApi, {
				checkHealth: () => Effect.void,
				getSystemConfig: (origin) =>
					Effect.sync(() => {
						requestedOrigins.push(origin);
						return config;
					}),
			}),
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
		createMemoryHistory({ initialEntries: ["/oauth/login"] }),
	);
	render(<RouterProvider router={router} />);
	return { requestedOrigins, authCallCount: () => authCalls };
};

describe("Hosted OAuth login", () => {
	it.live("shows a configured frontend mismatch without starting authentication", () =>
		Effect.gen(function* () {
			const mounted = mountLogin(
				systemConfig("https://configured.example", { oidcEnabled: true, localAuthDisabled: true }),
			);

			yield* Effect.promise(() => screen.findByText("Server configuration mismatch"));
			expect(
				screen.getByText(
					"This server is configured for https://configured.example. Open that address to sign in.",
				),
			).not.toBeNull();
			expect(mounted.authCallCount()).toBe(0);
		}),
	);

	it.live("uses the browser origin as a fixed server", () =>
		Effect.gen(function* () {
			const mounted = mountLogin(
				systemConfig(window.location.origin, { oidcEnabled: false, localAuthDisabled: false }),
			);

			yield* Effect.promise(() => screen.findByText(`Server: ${window.location.hostname}`));
			expect(mounted.requestedOrigins).toEqual([window.location.origin]);
			expect(screen.queryByRole("button", { name: "Change server" })).toBeNull();
		}),
	);

	it.live("shows an unavailable state when no authentication method is configured", () =>
		Effect.gen(function* () {
			mountLogin(
				systemConfig(window.location.origin, { oidcEnabled: false, localAuthDisabled: true }),
			);

			yield* Effect.promise(() => screen.findByText("Authentication unavailable"));
			expect(screen.getByText("This server has no browser sign-in method enabled.")).not.toBeNull();
		}),
	);
});
