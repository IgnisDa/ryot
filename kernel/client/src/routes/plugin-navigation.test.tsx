import type { PluginClientCatalog } from "@ryot/ryotql-recipes/plugin-client-catalog";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { AuthenticatedApi } from "../api/authenticated";
import { PublicApi } from "../api/public";
import { AuthClient } from "../modules/auth/client";
import { AuthService } from "../modules/auth/service";
import { PluginCatalogService } from "../modules/plugins/catalog";
import { ServerService } from "../modules/server/service";
import { ClientStorage } from "../persistence/storage";
import { getRouter } from "../router";

const server = "https://ryot.example";

const catalog: PluginClientCatalog = [
	{
		health: "ready",
		slug: "fixture",
		isDisabled: false,
		clientApiVersion: 1,
		pluginId: "plugin-1",
		clientCapabilities: [],
		sourceHash: "source-hash",
		installationId: "installation-1",
		clientArtifactHash: "artifact-hash",
	},
];

const StorageStub = Layer.succeed(ClientStorage, {
	remove: () => Effect.void,
	clearServerSelection: Effect.void,
	setServerSelection: () => Effect.void,
	setThemePreference: () => Effect.void,
	getServerSelection: Effect.succeed(server),
	getThemePreference: Effect.succeed("system" as const),
});

const ServerStub = Layer.succeed(ServerService, {
	connect: () => Effect.void,
	selected: Effect.succeed(server),
});

const AuthStub = Layer.succeed(AuthService, {
	signOut: () => Effect.void,
	changeServer: () => Effect.void,
	signInWithOidc: () => Effect.void,
	verifyTwoFactor: () => Effect.void,
	settledSession: () => Effect.succeed(authenticated),
	submitCredentials: () => Effect.succeed({ _tag: "Authenticated" } as const),
	session: () => ({ subscribe: () => () => undefined, getSnapshot: () => authenticated }),
});

const authenticated = {
	status: "authenticated",
	user: { id: "user-1", email: "user@ryot.example" },
} as const;

const mount = (initialEntry: string, entries: PluginClientCatalog = catalog) => {
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			AuthStub,
			ServerStub,
			PublicApi.layer,
			AuthClient.layer,
			AuthenticatedApi.layer,
			Layer.succeed(PluginCatalogService, { load: () => Effect.succeed(entries) }),
		).pipe(Layer.provideMerge(StorageStub)),
	);
	const router = getRouter(
		{ runtime, initialThemePreference: "system" },
		createMemoryHistory({ initialEntries: [initialEntry] }),
	);
	render(<RouterProvider router={router} />);
	return router;
};

const frame = () => screen.getByTitle<HTMLIFrameElement>("fixture plugin");

describe("plugin navigation", () => {
	it("resolves the plugin home directly from its global URL", async () => {
		const router = mount("/fixture");

		await waitFor(() => expect(frame().getAttribute("src")).toContain("/artifact-hash/index.html"));
		expect(router.state.location.pathname).toBe("/fixture");
	});

	it("restores a private route on a fresh load of its global URL", async () => {
		const router = mount("/fixture/details/item-1?tab=stats");

		await waitFor(() => expect(frame().getAttribute("src")).toContain("/artifact-hash/index.html"));
		expect(router.state.location.pathname).toBe("/fixture/details/item-1");
		expect(router.state.location.searchStr).toBe("?tab=stats");
	});

	it("keeps one plugin document across pushes, Back, and Forward", async () => {
		const router = mount("/fixture");
		await waitFor(() => expect(frame()).toBeTruthy());
		const document = frame();

		await router.navigate({ href: "/fixture/details/item-1?tab=stats" });
		await waitFor(() => expect(router.state.location.pathname).toBe("/fixture/details/item-1"));
		expect(frame()).toBe(document);

		router.history.back();
		await waitFor(() => expect(router.state.location.pathname).toBe("/fixture"));
		expect(frame()).toBe(document);

		router.history.forward();
		await waitFor(() => expect(router.state.location.pathname).toBe("/fixture/details/item-1"));
		expect(frame()).toBe(document);
	});

	it("drops a replaced entry out of the kernel history stack", async () => {
		const router = mount("/fixture");
		await waitFor(() => expect(frame()).toBeTruthy());

		await router.navigate({ href: "/fixture/details/item-1" });
		await waitFor(() => expect(router.state.location.pathname).toBe("/fixture/details/item-1"));
		await router.navigate({ href: "/fixture/details/item-2", replace: true });
		await waitFor(() => expect(router.state.location.pathname).toBe("/fixture/details/item-2"));

		router.history.back();

		await waitFor(() => expect(router.state.location.pathname).toBe("/fixture"));
	});

	it("never renders a plugin for a reserved or uninstalled slug", async () => {
		mount("/settings");
		await waitFor(() =>
			expect(screen.getByRole("status").textContent).toBe("This page does not exist."),
		);
		expect(screen.queryByTitle("fixture plugin")).toBeNull();

		mount("/missing");
		await waitFor(() => expect(screen.getAllByRole("status")).toHaveLength(2));
	});
});
