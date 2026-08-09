import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { AuthenticatedApi } from "#/api/authenticated";
import { PublicApi } from "#/api/public";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import { ArtifactSessions } from "#/modules/plugins/artifact-sessions";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/events.test-layer";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { PluginQueriesService } from "#/modules/plugins/queries";
import { ClientStorage } from "#/persistence/storage";
import { getRouter } from "#/router";
import {
	ServerStub,
	GodModeRouteStubs,
	SavedViewRouteStubs,
	ProviderAddRouteStubs,
	CustomizeRouteStubs,
	NavigationRouteStubs,
	theme,
	catalog,
	makeAuthStub,
	makeStorageStub,
	makeOAuthRouteStubs,
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
			signInWithOidc: () =>
				Effect.sync(() => {
					authCalls += 1;
				}),
		},
	);
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProviderAddRouteStubs,
			makeAuthStub(),
			GodModeRouteStubs,
			ServerStub,
			SavedViewRouteStubs,
			Layer.succeed(PublicApi, {
				checkHealth: () => Effect.void,
				getSystemConfig: (origin) =>
					Effect.sync(() => {
						requestedOrigins.push(origin);
						return config;
					}),
			}),
			Layer.succeed(PluginCatalogService, { load: () => Effect.succeed(catalog) }),
			NavigationRouteStubs,
			CustomizeRouteStubs,
			Layer.succeed(PluginQueriesService, { query: () => Effect.die("not used") }),
			Layer.succeed(PluginOperationsService, { invoke: () => Effect.die("not used") }),
			Layer.succeed(ArtifactSessions, {
				renew: () => Effect.die("not used"),
				revoke: () => Effect.die("not used"),
				create: () => Effect.die("not used"),
			}),
			makePluginCatalogEventsTestLayer().layer,
			AuthenticatedApi.layer,
		).pipe(
			Layer.provideMerge(oauth),
			Layer.provideMerge(Layer.succeed(ClientStorage, makeStorageStub())),
		),
	);
	const router = getRouter(
		{ runtime, theme, backInterceptors: createBackInterceptors() },
		createMemoryHistory({ initialEntries: ["/oauth/login"] }),
	);
	render(<RouterProvider router={router} />);
	return { requestedOrigins, authCallCount: () => authCalls };
};

describe("Hosted OAuth login", () => {
	it("shows a configured frontend mismatch without starting authentication", async () => {
		const mounted = mountLogin(
			systemConfig("https://configured.example", {
				oidcEnabled: true,
				localAuthDisabled: true,
			}),
		);

		await screen.findByText("Server configuration mismatch");
		expect(
			screen.getByText(
				"This server is configured for https://configured.example. Open that address to sign in.",
			),
		).not.toBeNull();
		expect(mounted.authCallCount()).toBe(0);
	});

	it("uses the browser origin as a fixed server", async () => {
		const mounted = mountLogin(
			systemConfig(window.location.origin, {
				oidcEnabled: false,
				localAuthDisabled: false,
			}),
		);

		await screen.findByText(`Server: ${window.location.hostname}`);
		expect(mounted.requestedOrigins).toEqual([window.location.origin]);
		expect(screen.queryByRole("button", { name: "Change server" })).toBeNull();
	});

	it("shows an unavailable state when no authentication method is configured", async () => {
		mountLogin(
			systemConfig(window.location.origin, {
				oidcEnabled: false,
				localAuthDisabled: true,
			}),
		);

		await screen.findByText("Authentication unavailable");
		expect(screen.getByText("This server has no browser sign-in method enabled.")).not.toBeNull();
	});
});
