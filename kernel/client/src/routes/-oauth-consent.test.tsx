import { describe, expect } from "bun:test";

import { testTimeout } from "@ryot-app/testing/test-timeout";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it } from "@voila.dev/effect-bun-test";
import { Effect, Layer, ManagedRuntime } from "effect";

import { KernelApiTestLayer } from "#/api/ports.test-layer";
import { PublicApi } from "#/api/public";
import { HostedAuthError, type HostedAuthService } from "#/modules/auth/hosted-service";
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

const details = {
	clientName: "Registered app",
	redirectOrigin: "https://client.example",
	scopes: ["ryot:read", "ryot:write", "ryot:write:unattended"],
} as const;

const mountConsent = (overrides: Partial<HostedAuthService["Service"]> = {}) => {
	const decisions: Array<{ query: string; accept: boolean; scopes: readonly string[] }> = [];
	const queries: string[] = [];
	const oauth = makeOAuthRouteStubs(
		{},
		{
			consentDetails: (query) =>
				Effect.sync(() => {
					queries.push(query);
					return details;
				}),
			submitConsent: (query, accept, scopes) =>
				Effect.sync(() => {
					decisions.push({ query, accept, scopes });
				}),
			...overrides,
		},
	);
	const config = systemConfig(window.location.origin, {
		oidcEnabled: false,
		localAuthDisabled: false,
	});
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProviderAddRouteStubs,
			ImportsRouteStubs,
			IntegrationRouteStubs,
			NotificationChannelRouteStubs,
			makeAuthStub(),
			InstanceAdminRouteStubs,
			ServerStub,
			ManagedAssetRouteStubs,
			Layer.succeed(PublicApi, {
				checkHealth: () => Effect.void,
				getSystemConfig: () => Effect.succeed(config),
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
		createMemoryHistory({ initialEntries: [`/oauth/consent?${signedOAuthQuery}`] }),
	);
	render(<RouterProvider router={router} />);
	return { router, queries, decisions };
};

describe("Hosted OAuth consent", () => {
	it.live(
		"renders only the server-verified permissions",
		() =>
			Effect.gen(function* () {
				const mounted = mountConsent();
				yield* Effect.promise(() => screen.findByRole("heading", { name: "Approve access" }));
				expect(screen.getByText("Registered app")).not.toBeNull();
				expect(screen.getByText("https://client.example")).not.toBeNull();
				expect(screen.getByRole("button", { name: /^Access:/ }).textContent).toContain(
					"Ask before each change",
				);
				expect(screen.queryByRole("listitem")).toBeNull();
				expect(screen.queryByText("openid")).toBeNull();
				expect(screen.queryByText("offline_access")).toBeNull();
				expect(mounted.queries).toEqual([signedOAuthQuery]);
				expect(mounted.decisions).toEqual([]);
			}),
		testTimeout,
	);

	it.live(
		"explains each requested identity and refresh permission",
		() =>
			Effect.gen(function* () {
				mountConsent({
					consentDetails: () =>
						Effect.succeed({
							...details,
							scopes: ["openid", "email", "profile", "offline_access", "ryot:read"],
						}),
				});
				yield* Effect.promise(() => screen.findByRole("heading", { name: "Approve access" }));
				expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
					"openid — Identify your account.",
					"email — Read your email address and whether it is verified.",
					"profile — Read your name and profile picture.",
					"offline_access — Keep access through refresh tokens when you are away.",
				]);
			}),
		testTimeout,
	);

	it.live(
		"retains the raw signed query when consent details are reloaded",
		() =>
			Effect.gen(function* () {
				const mounted = mountConsent();
				yield* Effect.promise(() => screen.findByRole("heading", { name: "Approve access" }));
				yield* Effect.promise(() => mounted.router.invalidate());
				expect(mounted.queries).toEqual([signedOAuthQuery, signedOAuthQuery]);
				expect(mounted.router.history.location.search).toBe(`?${signedOAuthQuery}`);
			}),
		testTimeout,
	);

	it.live.each([
		{ accept: true, action: "Approve" },
		{ accept: false, action: "Deny" },
	])(
		"submits $action with the original authorization query",
		({ action, accept }) =>
			Effect.gen(function* () {
				const mounted = mountConsent();
				const button = yield* Effect.promise(() => screen.findByRole("button", { name: action }));
				yield* Effect.promise(() => userEvent.click(button));
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(mounted.decisions).toEqual([
							{ accept, query: signedOAuthQuery, scopes: ["ryot:read", "ryot:write"] },
						]),
					),
				);
				expect(screen.getByRole<HTMLButtonElement>("button", { name: "Approve" }).disabled).toBe(
					true,
				);
				expect(screen.getByRole<HTMLButtonElement>("button", { name: "Deny" }).disabled).toBe(true);
			}),
		testTimeout,
	);

	it.live.each([
		{
			choice: "Allow changes without asking",
			granted: ["ryot:read", "ryot:write", "ryot:write:unattended"],
			requested: ["ryot:read", "ryot:write", "ryot:write:unattended"],
		},
		{ choice: "Read only", granted: ["ryot:read"], requested: ["ryot:read"] },
	] as const)(
		"grants $choice within the requested access",
		({ choice, granted, requested }) =>
			Effect.gen(function* () {
				const mounted = mountConsent({
					consentDetails: () => Effect.succeed({ ...details, scopes: [...requested] }),
				});
				const access = yield* Effect.promise(() =>
					screen.findByRole("button", { name: /^Access:/ }),
				);
				yield* Effect.promise(() => userEvent.click(access));
				expect(screen.getAllByRole("radio")).toHaveLength(requested.length);
				yield* Effect.promise(() => userEvent.click(screen.getByRole("radio", { name: choice })));
				yield* Effect.promise(() =>
					userEvent.click(screen.getByRole("button", { name: "Approve" })),
				);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(mounted.decisions).toEqual([
							{ accept: true, scopes: granted, query: signedOAuthQuery },
						]),
					),
				);
			}),
		testTimeout,
	);

	it.live(
		"keeps the decision available after a submission error",
		() =>
			Effect.gen(function* () {
				mountConsent({
					submitConsent: () => Effect.fail(new HostedAuthError({ message: "Connection lost" })),
				});
				const button = yield* Effect.promise(() =>
					screen.findByRole("button", { name: "Approve" }),
				);
				yield* Effect.promise(() => userEvent.click(button));
				const alert = yield* Effect.promise(() => screen.findByRole("alert"));
				expect(alert.textContent).toBe("Connection lost");
				expect(screen.getByRole<HTMLButtonElement>("button", { name: "Deny" }).disabled).toBe(
					false,
				);
			}),
		testTimeout,
	);

	it.live(
		"does not offer consent for an invalid request",
		() =>
			Effect.gen(function* () {
				mountConsent({
					consentDetails: () => Effect.fail(new HostedAuthError({ message: "Invalid signature" })),
				});
				yield* Effect.promise(() => screen.findByText("Invalid signature"));
				expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
				expect(screen.queryByText("Registered app")).toBeNull();
			}),
		testTimeout,
	);

	it.live.each(["load", "submit"] as const)(
		"preserves the signed query when the hosted session expires during %s",
		(stage) =>
			Effect.gen(function* () {
				const failure = Effect.fail(
					new HostedAuthError({ code: "UNAUTHORIZED", message: "Session expired" }),
				);
				mountConsent(
					stage === "load" ? { consentDetails: () => failure } : { submitConsent: () => failure },
				);
				if (stage === "submit") {
					const button = yield* Effect.promise(() =>
						screen.findByRole("button", { name: "Approve" }),
					);
					yield* Effect.promise(() => userEvent.click(button));
				}
				const link = yield* Effect.promise(() => screen.findByRole("link", { name: "Sign in" }));
				expect(link.getAttribute("href")).toBe(`/oauth/login?${signedOAuthQuery}`);
				expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
			}),
		testTimeout,
	);
});
