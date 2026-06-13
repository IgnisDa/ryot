import {
	PluginThemeSnapshot,
	REQUIRED_THEME_TOKEN_NAMES,
} from "@ryot/contract/modules/plugins/client";
import type { PluginClientCatalog } from "@ryot/ryotql-recipes/plugin-client-catalog";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { AuthenticatedApi } from "#/api/authenticated";
import { PublicApi } from "#/api/public";
import { AuthClient } from "#/modules/auth/client";
import { AuthService } from "#/modules/auth/service";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/events.test-layer";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { PluginQueriesService } from "#/modules/plugins/queries";
import { ServerService } from "#/modules/server/service";
import type { ThemeStore } from "#/modules/theme/store";
import { ClientStorage } from "#/persistence/storage";
import { getRouter } from "#/router";

const server = "https://ryot.example";
const theme: ThemeStore = {
	destroy: () => undefined,
	getPreference: () => "system",
	setPreference: () => undefined,
	subscribe: () => () => undefined,
	getSnapshot: () =>
		Schema.decodeUnknownSync(PluginThemeSnapshot)({
			resolvedMode: "light",
			tokens: Object.fromEntries(REQUIRED_THEME_TOKEN_NAMES.map((name) => [name, name])),
		}),
};

const catalog: PluginClientCatalog = [
	{
		sortOrder: 0,
		icon: "puzzle",
		name: "Fixture",
		health: "ready",
		slug: "fixture",
		isDisabled: false,
		clientApiVersion: 1,
		pluginId: "plugin-1",
		sourceHash: "source-hash",
		installationId: "installation-1",
		clientArtifactHash: "artifact-hash",
	},
];

const authenticated = {
	status: "authenticated",
	user: { image: null, id: "user-1", name: "Test User", email: "user@ryot.example" },
} as const;

const AuthStub = Layer.succeed(AuthService, {
	signOut: () => Effect.void,
	changeServer: () => Effect.void,
	signInWithOidc: () => Effect.void,
	verifyTwoFactor: () => Effect.void,
	settledSession: () => Effect.succeed(authenticated),
	submitCredentials: () => Effect.succeed({ _tag: "Authenticated" } as const),
	session: () => ({ subscribe: () => () => undefined, getSnapshot: () => authenticated }),
});

const ServerStub = Layer.succeed(ServerService, {
	connect: () => Effect.void,
	selected: Effect.succeed(server),
});

const makeStorageStub = (rememberedSlug: string | null = "fixture"): ClientStorage["Service"] => ({
	remove: () => Effect.void,
	clearServerSelection: Effect.void,
	setLastWorkspace: () => Effect.void,
	setServerSelection: () => Effect.void,
	setThemePreference: () => Effect.void,
	getServerSelection: Effect.succeed(server),
	getThemePreference: Effect.succeed("system" as const),
	getLastWorkspace: () => Effect.succeed(rememberedSlug),
});

const mountView = (
	initialEntry: string | string[],
	rememberedSlug: string | null = "fixture",
	entries: PluginClientCatalog = catalog,
) => {
	const events = makePluginCatalogEventsTestLayer();
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			AuthStub,
			ServerStub,
			PublicApi.layer,
			AuthClient.layer,
			AuthenticatedApi.layer,
			events.layer,
			Layer.succeed(PluginCatalogService, { load: () => Effect.succeed(entries) }),
			Layer.succeed(PluginOperationsService, { invoke: () => Effect.die("not used") }),
			Layer.succeed(PluginQueriesService, { query: () => Effect.die("not used") }),
		).pipe(Layer.provideMerge(Layer.succeed(ClientStorage, makeStorageStub(rememberedSlug)))),
	);
	const initialEntries = typeof initialEntry === "string" ? [initialEntry] : initialEntry;
	const router = getRouter({ runtime, theme }, createMemoryHistory({ initialEntries }));
	const view = render(<RouterProvider router={router} />);
	return { ...view, router };
};

const stubDesktopMatchMedia = () => {
	const original = window.matchMedia;
	window.matchMedia = ((query: string) => ({
		media: query,
		onchange: null,
		dispatchEvent: () => false,
		addListener: () => undefined,
		removeListener: () => undefined,
		addEventListener: () => undefined,
		removeEventListener: () => undefined,
		matches: query === "(min-width: 768px)",
	})) as typeof window.matchMedia;
	return () => {
		window.matchMedia = original;
	};
};

describe("settings navigation", () => {
	it("marks the active section on the desktop settings sidebar", async () => {
		const view = mountView("/settings/preferences");
		const sidebar = await screen.findByTestId("settings-sidebar");
		const preferences = within(sidebar).getByRole("link", { name: "Preferences" });
		const account = within(sidebar).getByRole("link", { name: "Account" });

		expect(preferences.getAttribute("aria-current")).toBe("page");
		expect(preferences.getAttribute("class")).toContain("bg-nav-indicator");
		expect(account.getAttribute("aria-current")).toBeNull();

		await view.router.navigate({ href: "/settings/account" });
		await waitFor(() => expect(view.router.state.location.pathname).toBe("/settings/account"));
		const accountAfterNavigate = within(screen.getByTestId("settings-sidebar")).getByRole("link", {
			name: "Account",
		});
		expect(accountAfterNavigate.getAttribute("aria-current")).toBe("page");
		expect(accountAfterNavigate.getAttribute("class")).toContain("bg-nav-indicator");
	});

	it("navigates with replace when selecting a section from the desktop sidebar", async () => {
		const view = mountView(["/fixture", "/settings/preferences"]);
		const sidebar = await screen.findByTestId("settings-sidebar");

		fireEvent.click(within(sidebar).getByRole("link", { name: "Account" }));
		await waitFor(() => expect(view.router.state.location.pathname).toBe("/settings/account"));

		view.router.history.back();
		await waitFor(() => expect(view.router.state.location.pathname).toBe("/fixture"));
	});

	it("renders the mobile settings index with disclosure rows and pushes on selection", async () => {
		const view = mountView("/settings");
		await screen.findByRole("heading", { level: 1, name: "Settings" });
		const sections = screen.getByTestId("settings-index-sections");
		const preferences = within(sections).getByRole("link", { name: "Preferences" });
		expect(preferences.querySelector('[data-app-icon="chevron-right"]')).not.toBeNull();

		fireEvent.click(preferences);
		await waitFor(() => expect(view.router.state.location.pathname).toBe("/settings/preferences"));

		view.router.history.back();
		await waitFor(() => expect(view.router.state.location.pathname).toBe("/settings"));
	});

	it("replaces to preferences on desktop when /settings crosses into the desktop breakpoint", async () => {
		const restore = stubDesktopMatchMedia();
		try {
			const view = mountView("/settings");
			await waitFor(() =>
				expect(view.router.state.location.pathname).toBe("/settings/preferences"),
			);
		} finally {
			restore();
		}
	});

	it("hides the global mobile shell header on settings routes while keeping the desktop sidebar", async () => {
		mountView("/settings/preferences");
		await screen.findByTestId("settings-sidebar");
		expect(screen.getByTestId("desktop-sidebar")).toBeTruthy();
		expect(screen.queryByTestId("mobile-header")).toBeNull();
		expect(screen.queryByTestId("mobile-drawer")).toBeNull();
	});

	it("returns to the previous entry when back is used after navigating into a detail route", async () => {
		const view = mountView(["/fixture", "/settings"]);
		await screen.findByRole("heading", { level: 1, name: "Settings" });
		const sections = screen.getByTestId("settings-index-sections");

		fireEvent.click(within(sections).getByRole("link", { name: "Preferences" }));
		await waitFor(() => expect(view.router.state.location.pathname).toBe("/settings/preferences"));

		fireEvent.click(screen.getByRole("button", { name: "Go back" }));
		await waitFor(() => expect(view.router.state.location.pathname).toBe("/settings"));
	});

	it("replaces to /settings on direct entry to a detail route", async () => {
		const view = mountView("/settings/preferences");
		await screen.findByRole("heading", { name: "Preferences" });

		fireEvent.click(screen.getByRole("button", { name: "Go back" }));
		await waitFor(() => expect(view.router.state.location.pathname).toBe("/settings"));
		expect(view.router.history.canGoBack()).toBe(false);
	});

	it("replaces to the remembered workspace route on direct entry to /settings", async () => {
		const view = mountView("/settings", "fixture");
		await screen.findByRole("heading", { level: 1, name: "Settings" });

		fireEvent.click(screen.getByRole("button", { name: "Go back" }));
		await waitFor(() => expect(view.router.state.location.pathname).toBe("/fixture"));
		expect(view.router.history.canGoBack()).toBe(false);
	});
});
