import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { KernelApiTestLayer } from "#/api/ports.test-layer";
import { OAuthTokenError } from "#/modules/auth/token-service";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import { ArtifactSessions } from "#/modules/plugins/artifact-sessions";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/events.test-layer";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { PluginQueriesService } from "#/modules/plugins/queries";
import { ClientStorage } from "#/persistence/storage";
import { getRouter } from "#/router";
import {
	theme,
	server,
	catalog,
	ServerStub,
	makeAuthStub,
	makeStorageStub,
	GodModeRouteStubs,
	makePublicApiStub,
	CustomizeRouteStubs,
	SavedViewRouteStubs,
	makeOAuthRouteStubs,
	NavigationRouteStubs,
	ProviderAddRouteStubs,
	IntegrationRouteStubs,
} from "#/routes/-route-fixtures";

type Exchange = {
	readonly code: string;
	readonly state: string;
	readonly origin: string;
	readonly clientId: string;
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
	options: { readonly destination?: string; readonly fail?: boolean } = {},
) => {
	const exchanges: Exchange[] = [];
	const rejected: string[] = [];
	const oauth = makeOAuthRouteStubs({
		rejectAuthorization: (_origin, state) =>
			Effect.sync(() => rejected.push(state)).pipe(
				Effect.andThen(Effect.fail(new OAuthTokenError({ reason: "authorization-rejected" }))),
			),
		completeAuthorization: (origin, clientId, redirectUri, state, code) => {
			exchanges.push({ code, state, origin, clientId, redirectUri });
			return options.fail
				? Effect.fail(new OAuthTokenError({ reason: "missing-authorization" }))
				: Effect.succeed(pending(options.destination));
		},
	});
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProviderAddRouteStubs,
			IntegrationRouteStubs,
			makeAuthStub(),
			GodModeRouteStubs,
			ServerStub,
			SavedViewRouteStubs,
			makePublicApiStub(),
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
			KernelApiTestLayer,
		).pipe(
			Layer.provideMerge(oauth),
			Layer.provideMerge(Layer.succeed(ClientStorage, makeStorageStub())),
		),
	);
	const router = getRouter(
		{ runtime, theme, backInterceptors: createBackInterceptors() },
		createMemoryHistory({
			initialEntries: typeof initialEntry === "string" ? [initialEntry] : [...initialEntry],
		}),
	);
	render(<RouterProvider router={router} />);
	return { exchanges, rejected, router };
};

const settledPath = async (router: ReturnType<typeof mountCallback>["router"]) => {
	await waitFor(() => expect(router.state.location.pathname).not.toBe("/auth/callback"));
	return router.state.location;
};

describe("OAuth callback", () => {
	it("exchanges the code against the expected web client and drops callback parameters", async () => {
		const { exchanges, router } = mountCallback("/auth/callback?code=code-1&state=state", {
			destination: "/settings",
		});
		const location = await settledPath(router);
		expect(exchanges).toEqual([
			{
				code: "code-1",
				state: "state",
				clientId: "ryot-web",
				origin: window.location.origin,
				redirectUri: `${window.location.origin}/auth/callback`,
			},
		]);
		expect(location.pathname).toBe("/settings");
		expect(location.searchStr).toBe("");
	});

	it("rejects replayed or unknown state", async () => {
		const { router } = mountCallback("/auth/callback?code=code-1&state=spent", { fail: true });
		await screen.findByText("Could not complete sign-in");
		expect(router.state.location.pathname).toBe("/auth/callback");
	});

	it("consumes an authorization error by state", async () => {
		const { rejected } = mountCallback("/auth/callback?error=access_denied&state=state");
		await screen.findByText("Could not complete sign-in");
		expect(rejected).toEqual(["state"]);
	});

	it("replaces the callback history entry", async () => {
		const { router } = mountCallback(["/settings", "/auth/callback?code=code-1&state=state"]);
		await settledPath(router);
		expect(router.history.length).toBe(2);
	});
});
