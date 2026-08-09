import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, waitFor } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { AuthenticatedApi } from "#/api/authenticated";
import { AuthClient, AuthClientError } from "#/modules/auth/client";
import { ArtifactSessions } from "#/modules/plugins/artifact-sessions";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/events.test-layer";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { PluginQueriesService } from "#/modules/plugins/queries";
import { ClientStorage } from "#/persistence/storage";
import { getRouter } from "#/router";
import {
	ServerStub,
	catalog,
	makeAuthStub,
	makePublicApiStub,
	makeStorageStub,
	server,
	theme,
	unauthenticated,
} from "#/routes/-route-fixtures";

type Exchange = { readonly origin: string; readonly token: string };

const mountCallback = (
	initialEntry: string | readonly string[],
	verify: (exchange: Exchange) => Effect.Effect<void, AuthClientError> = () => Effect.void,
	session?: typeof unauthenticated,
) => {
	const exchanges: Exchange[] = [];
	const authLayer = makeAuthStub(
		{
			verifyOneTimeToken: (origin, token) => {
				exchanges.push({ origin, token });
				return verify({ origin, token });
			},
		},
		session,
	);
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			authLayer,
			ServerStub,
			AuthClient.layer,
			makePublicApiStub(),
			AuthenticatedApi.layer,
			makePluginCatalogEventsTestLayer().layer,
			Layer.succeed(PluginCatalogService, { load: () => Effect.succeed(catalog) }),
			Layer.succeed(PluginQueriesService, { query: () => Effect.die("not used") }),
			Layer.succeed(PluginOperationsService, { invoke: () => Effect.die("not used") }),
			Layer.succeed(ArtifactSessions, {
				renew: () => Effect.die("not used"),
				revoke: () => Effect.die("not used"),
				create: () => Effect.die("not used"),
			}),
		).pipe(Layer.provideMerge(Layer.succeed(ClientStorage, makeStorageStub()))),
	);
	const router = getRouter(
		{ runtime, theme },
		createMemoryHistory({
			initialEntries: typeof initialEntry === "string" ? [initialEntry] : [...initialEntry],
		}),
	);
	render(<RouterProvider router={router} />);
	return { exchanges, router };
};

const settledPath = async (router: ReturnType<typeof mountCallback>["router"]) => {
	await waitFor(() => expect(router.state.location.pathname).not.toBe("/auth/callback"));
	return router.state.location;
};

describe("oidc callback", () => {
	it("exchanges the one-time token against the selected server and drops it from the URL", async () => {
		const { exchanges, router } = mountCallback("/auth/callback?token=ott-1&redirect=%2Fsettings");
		const location = await settledPath(router);
		expect(exchanges).toEqual([{ origin: server, token: "ott-1" }]);
		expect(location.pathname).toBe("/settings");
		expect(location.searchStr).not.toContain("ott-1");
	});

	it("enters the app when the handoff carried no redirect", async () => {
		const { exchanges, router } = mountCallback("/auth/callback?token=ott-1");
		const location = await settledPath(router);
		expect(location.pathname).toBe("/fixture");
		expect(exchanges).toEqual([{ origin: server, token: "ott-1" }]);
	});

	it("bounces back to sign-in when the server could not mint a token", async () => {
		const { exchanges, router } = mountCallback("/auth/callback", undefined, unauthenticated);
		const location = await settledPath(router);
		expect(location.pathname).toBe("/auth");
		expect(exchanges).toEqual([]);
	});

	it("bounces back to sign-in when the token is spent, expired, or forged", async () => {
		const { exchanges, router } = mountCallback(
			"/auth/callback?token=stale",
			() => Effect.fail(new AuthClientError({ message: "Could not complete sign-in." })),
			unauthenticated,
		);
		const location = await settledPath(router);
		expect(exchanges).toEqual([{ origin: server, token: "stale" }]);
		expect(location.pathname).toBe("/auth");
		expect(location.searchStr).not.toContain("stale");
	});

	it("replaces the callback entry instead of pushing a new one, on web and native alike", async () => {
		const { router } = mountCallback([
			"/settings",
			"/auth/callback?token=ott-1&redirect=%2Fsettings",
		]);
		await settledPath(router);
		expect(router.history.length).toBe(2);
	});
});
