import {
	PluginThemeSnapshot,
	REQUIRED_THEME_TOKEN_NAMES,
} from "@ryot/contract/modules/plugins/client";
import type { PluginClientCatalog } from "@ryot/ryotql-recipes/plugin-client-catalog";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Deferred, Effect, Layer, ManagedRuntime, Schema } from "effect";
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

const unauthenticated = { status: "missing" } as const;

const makeAuthStub = (
	overrides: Partial<AuthService["Service"]> = {},
	session: typeof authenticated | typeof unauthenticated = authenticated,
) =>
	Layer.succeed(AuthService, {
		signOut: () => Effect.void,
		changeServer: () => Effect.void,
		signInWithOidc: () => Effect.void,
		verifyTwoFactor: () => Effect.void,
		settledSession: () => Effect.succeed(session),
		submitCredentials: () => Effect.succeed({ _tag: "Authenticated" } as const),
		session: () => ({ subscribe: () => () => undefined, getSnapshot: () => session }),
		...overrides,
	});

const AuthStub = makeAuthStub();

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
	authLayer: Layer.Layer<AuthService> = AuthStub,
) => {
	const events = makePluginCatalogEventsTestLayer();
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			authLayer,
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

describe("authenticated route gate", () => {
	it.each(["/", "/fixture", "/settings", "/settings/preferences", "/settings/account"])(
		"redirects an unauthenticated visitor from %s to /auth",
		async (path) => {
			const view = mountView(path, undefined, undefined, makeAuthStub({}, unauthenticated));
			await waitFor(() => expect(view.router.state.location.pathname).toBe("/auth"));
			expect(view.router.state.location.search.redirect).toBe(path);
		},
	);
});

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

describe("account settings", () => {
	it("renders the current identity: name, email, user ID, and server origin", async () => {
		mountView("/settings/account");
		await screen.findByRole("heading", { name: "Account" });

		const profile = screen.getByRole("heading", { name: "Profile" }).closest("section");
		expect(profile).not.toBeNull();
		expect(profile?.textContent).toContain("Test User");
		expect(profile?.textContent).toContain("user@ryot.example");
		expect(profile?.textContent).toContain("ID: user-1");
		expect(profile?.textContent).toContain("https://ryot.example");
	});

	it("disables both actions while sign out is pending and navigates to /auth on success", async () => {
		const gate = Effect.runSync(Deferred.make<void>());
		const view = mountView(
			"/settings/account",
			undefined,
			undefined,
			makeAuthStub({ signOut: () => Deferred.await(gate) }),
		);
		await screen.findByRole("heading", { name: "Account" });

		fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
		await screen.findByRole("button", { name: "Signing out…" });
		expect(screen.getByRole("button", { name: "Signing out…" }).hasAttribute("disabled")).toBe(
			true,
		);
		expect(screen.getByRole("button", { name: "Change server" }).hasAttribute("disabled")).toBe(
			true,
		);

		await Effect.runPromise(Deferred.succeed(gate, undefined));
		await waitFor(() => expect(view.router.state.location.pathname).toBe("/auth"));
	});

	it("stays put and renders a stable failure message when sign out fails", async () => {
		const view = mountView(
			"/settings/account",
			undefined,
			undefined,
			makeAuthStub({ signOut: () => Effect.die("sign out failed") }),
		);
		await screen.findByRole("heading", { name: "Account" });

		fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

		await screen.findByRole("alert");
		expect(screen.getByRole("alert").textContent).toBe("Could not sign out.");
		expect(view.router.state.location.pathname).toBe("/settings/account");
		expect(screen.getByRole("button", { name: "Sign out" }).hasAttribute("disabled")).toBe(false);
	});

	it("disables both actions while changing server is pending and navigates to /onboarding on success", async () => {
		const gate = Effect.runSync(Deferred.make<void>());
		const view = mountView(
			"/settings/account",
			undefined,
			undefined,
			makeAuthStub({ changeServer: () => Deferred.await(gate) }),
		);
		await screen.findByRole("heading", { name: "Account" });

		fireEvent.click(screen.getByRole("button", { name: "Change server" }));
		await screen.findByRole("button", { name: "Changing server…" });
		expect(screen.getByRole("button", { name: "Changing server…" }).hasAttribute("disabled")).toBe(
			true,
		);
		expect(screen.getByRole("button", { name: "Sign out" }).hasAttribute("disabled")).toBe(true);

		await Effect.runPromise(Deferred.succeed(gate, undefined));
		await waitFor(() => expect(view.router.state.location.pathname).toBe("/onboarding"));
	});

	it("stays put and renders a stable failure message when changing server fails", async () => {
		const view = mountView(
			"/settings/account",
			undefined,
			undefined,
			makeAuthStub({ changeServer: () => Effect.die("change server failed") }),
		);
		await screen.findByRole("heading", { name: "Account" });

		fireEvent.click(screen.getByRole("button", { name: "Change server" }));

		await screen.findByRole("alert");
		expect(screen.getByRole("alert").textContent).toBe("Could not change server.");
		expect(view.router.state.location.pathname).toBe("/settings/account");
		expect(screen.getByRole("button", { name: "Change server" }).hasAttribute("disabled")).toBe(
			false,
		);
	});
});
