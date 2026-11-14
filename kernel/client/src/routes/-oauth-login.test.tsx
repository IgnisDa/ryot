import { describe, expect } from "bun:test";

import { testTimeout } from "@ryot-app/testing/test-timeout";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it } from "@voila.dev/effect-bun-test";
import { Effect, Layer, ManagedRuntime } from "effect";

import { KernelApiTestLayer } from "#/api/ports.test-layer";
import { PublicApi } from "#/api/public";
import type { HostedAuthService } from "#/modules/auth/hosted-service";
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
	ImportsRouteStubs,
	InstanceAdminRouteStubs,
	IntegrationRouteStubs,
	makeAuthStub,
	makeOAuthRouteStubs,
	makeStorageStubLayer,
	ManagedAssetRouteStubs,
	NavigationRouteStubs,
	NotificationChannelRouteStubs,
	PagesApiRouteStubs,
	ProviderAddRouteStubs,
	ServerStub,
	signedOAuthQuery,
	theme,
} from "#/routes/-route-fixtures";

const systemConfig = (
	frontendOrigin: string,
	auth: { readonly oidcEnabled: boolean; readonly localAuthDisabled: boolean },
) => ({
	analytics: {},
	frontendOrigin,
	version: "v1.0.0",
	pro: { isServerKeyValidated: false },
	notifications: { smtpEnabled: false },
	auth: { ...auth, signupAllowed: true },
	fileStorage: {
		temporaryUploadProvider: "local" as const,
		preferredPermanentUploadProvider: "local" as const,
	},
});

const mountLogin = (
	config: ReturnType<typeof systemConfig>,
	hosted: Partial<HostedAuthService["Service"]> = {},
	path = "/oauth/login",
) => {
	let authCalls = 0;
	const requestedOrigins: string[] = [];
	const oauth = makeOAuthRouteStubs(
		{},
		{
			signInWithOidc: () =>
				Effect.sync(() => {
					authCalls += 1;
				}),
			...hosted,
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
			InstanceAdminRouteStubs,
			ServerStub,
			ManagedAssetRouteStubs,
			Layer.succeed(PublicApi, {
				checkHealth: () => Effect.void,
				getSystemConfig: (origin) =>
					Effect.sync(() => {
						requestedOrigins.push(origin);
						return config;
					}),
			}),
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
		createMemoryHistory({ initialEntries: [path] }),
	);
	render(<RouterProvider router={router} />);
	return { requestedOrigins, authCallCount: () => authCalls };
};

describe("Hosted OAuth login", () => {
	it.live(
		"preserves repeated signed parameters through password and two-factor submission",
		() =>
			Effect.gen(function* () {
				const queries: string[] = [];
				mountLogin(
					systemConfig(window.location.origin, { oidcEnabled: false, localAuthDisabled: false }),
					{
						verifyTwoFactor: (_method, _code, oauthQuery) =>
							Effect.sync(() => {
								queries.push(oauthQuery);
							}),
						submitCredentials: ({ oauthQuery }) =>
							Effect.sync(() => {
								queries.push(oauthQuery);
								return { _tag: "TwoFactor", methods: ["totp", "backupCode"] } as const;
							}),
					},
					`/oauth/login?${signedOAuthQuery}`,
				);
				const user = userEvent.setup();
				yield* Effect.promise(() => screen.findByLabelText("Email address"));
				yield* Effect.promise(() =>
					user.type(screen.getByLabelText("Email address"), "user@ryot.example"),
				);
				yield* Effect.promise(() => user.type(screen.getByLabelText("Password"), "Sup3rSecret"));
				yield* Effect.promise(() => user.keyboard("{Enter}"));
				yield* Effect.promise(() => screen.findByLabelText("Authenticator code"));
				yield* Effect.promise(() =>
					user.type(screen.getByLabelText("Authenticator code"), "123456"),
				);
				yield* Effect.promise(() => user.click(screen.getByRole("button", { name: "Verify" })));
				yield* Effect.promise(() =>
					waitFor(() => expect(queries).toEqual([signedOAuthQuery, signedOAuthQuery])),
				);
			}),
		testTimeout,
	);

	it.live(
		"preserves the raw signed query when starting OIDC",
		() =>
			Effect.gen(function* () {
				const queries: string[] = [];
				mountLogin(
					systemConfig(window.location.origin, { oidcEnabled: true, localAuthDisabled: true }),
					{
						signInWithOidc: (query) =>
							Effect.sync(() => {
								queries.push(query);
							}),
					},
					`/oauth/login?${signedOAuthQuery}`,
				);
				yield* Effect.promise(() => waitFor(() => expect(queries).toEqual([signedOAuthQuery])));
			}),
		testTimeout,
	);

	it.live(
		"shows a configured frontend mismatch without starting authentication",
		() =>
			Effect.gen(function* () {
				const mounted = mountLogin(
					systemConfig("https://configured.example", {
						oidcEnabled: true,
						localAuthDisabled: true,
					}),
				);

				yield* Effect.promise(() => screen.findByText("Server configuration mismatch"));
				expect(
					screen.getByText(
						"This server is configured for https://configured.example. Open that address to sign in.",
					),
				).not.toBeNull();
				expect(mounted.authCallCount()).toBe(0);
			}),
		testTimeout,
	);

	it.live(
		"uses the browser origin as a fixed server",
		() =>
			Effect.gen(function* () {
				const mounted = mountLogin(
					systemConfig(window.location.origin, { oidcEnabled: false, localAuthDisabled: false }),
				);

				yield* Effect.promise(() => screen.findByText(`Server: ${window.location.hostname}`));
				expect(mounted.requestedOrigins).toEqual([window.location.origin]);
				expect(screen.queryByRole("button", { name: "Change server" })).toBeNull();
			}),
		testTimeout,
	);

	it.live(
		"shows an unavailable state when no authentication method is configured",
		() =>
			Effect.gen(function* () {
				mountLogin(
					systemConfig(window.location.origin, { oidcEnabled: false, localAuthDisabled: true }),
				);

				yield* Effect.promise(() => screen.findByText("Authentication unavailable"));
				expect(
					screen.getByText("This server has no browser sign-in method enabled."),
				).not.toBeNull();
			}),
		testTimeout,
	);
});
