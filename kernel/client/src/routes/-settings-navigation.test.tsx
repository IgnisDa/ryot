import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Deferred, Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { AuthenticatedApi } from "#/api/authenticated";
import { PublicApi, PublicApiError } from "#/api/public";
import type { AuthService } from "#/modules/auth/service";
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
	OAuthRouteStubs,
	GodModeRouteStubs,
	SavedViewRouteStubs,
	ProviderAddRouteStubs,
	NavigationRouteStubs,
	theme,
	server,
	catalog,
	makeAuthStub,
	authenticated,
	makeStorageStub,
	unauthenticated,
	makePublicApiStub,
	makeWorkspaceRecorder,
} from "#/routes/-route-fixtures";

const AuthStub = makeAuthStub();

const mountView = (
	initialEntry: string | string[],
	rememberedSlug: string | null = "fixture",
	entries: PluginClientCatalog = catalog,
	authLayer: Layer.Layer<AuthService> = AuthStub,
	publicLayer = makePublicApiStub(),
	storage: ClientStorage["Service"] = makeStorageStub(rememberedSlug),
) => {
	const events = makePluginCatalogEventsTestLayer();
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProviderAddRouteStubs,
			authLayer,
			GodModeRouteStubs,
			ServerStub,
			SavedViewRouteStubs,
			publicLayer,
			AuthenticatedApi.layer,
			events.layer,
			Layer.succeed(ArtifactSessions, {
				renew: () => Effect.die("not used"),
				revoke: () => Effect.die("not used"),
				create: ({ clientArtifactHash }) =>
					Effect.succeed({
						sessionId: "session-1",
						expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
						src: `https://ryot.example/session/${clientArtifactHash}/index.html`,
					}),
			}),
			Layer.succeed(PluginCatalogService, { load: () => Effect.succeed(entries) }),
			NavigationRouteStubs,
			Layer.succeed(PluginOperationsService, { invoke: () => Effect.die("not used") }),
			Layer.succeed(PluginQueriesService, { query: () => Effect.die("not used") }),
		).pipe(
			Layer.provideMerge(OAuthRouteStubs),
			Layer.provideMerge(Layer.succeed(ClientStorage, storage)),
		),
	);
	const initialEntries = typeof initialEntry === "string" ? [initialEntry] : initialEntry;
	const router = getRouter(
		{ runtime, theme, backInterceptors: createBackInterceptors() },
		createMemoryHistory({ initialEntries }),
	);
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

	it("keeps an unmatched settings path inside the settings layout", async () => {
		const view = mountView("/settings/account/security");
		const sidebar = await screen.findByTestId("settings-sidebar");

		expect(view.router.state.location.pathname).toBe("/settings/account/security");
		expect(screen.getByRole("status").textContent).toBe("This page does not exist.");
		expect(screen.queryByTitle("fixture plugin")).toBeNull();
		expect(
			within(sidebar).getByRole("link", { name: "Account" }).getAttribute("aria-current"),
		).toBe("page");
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

	it("falls back to a workspace chosen during the current shell lifetime", async () => {
		const recorder = makeWorkspaceRecorder();
		const entries: PluginClientCatalog = [
			catalog[0],
			{
				...catalog[0],
				sortOrder: 1,
				name: "Journal",
				slug: "journal",
				pluginId: "plugin-2",
				installationId: "installation-2",
			},
		];
		const view = mountView(
			"/fixture",
			"fixture",
			entries,
			undefined,
			undefined,
			makeStorageStub("fixture", recorder),
		);
		await screen.findByTitle("fixture plugin");

		fireEvent.click(screen.getByRole("button", { name: "Fixture workspace, fixture" }));
		fireEvent.click(screen.getByRole("menuitemradio", { name: "Switch to Journal workspace" }));
		await waitFor(() =>
			expect(recorder.setCalls).toEqual([
				{ slug: "journal", scope: { serverUrl: server, userId: authenticated.user.id } },
			]),
		);
		await view.router.navigate({ href: "/settings", replace: true });
		await screen.findByRole("heading", { level: 1, name: "Settings" });

		fireEvent.click(screen.getByRole("button", { name: "Go back" }));
		await waitFor(() => expect(view.router.state.location.pathname).toBe("/journal"));
		expect(view.router.history.canGoBack()).toBe(false);
	});

	it("does not adopt a workspace reached only by its direct route", async () => {
		const recorder = makeWorkspaceRecorder();
		const entries: PluginClientCatalog = [
			catalog[0],
			{
				...catalog[0],
				sortOrder: 1,
				name: "Journal",
				slug: "journal",
				pluginId: "plugin-2",
				installationId: "installation-2",
			},
		];
		const view = mountView(
			"/fixture",
			"fixture",
			entries,
			undefined,
			undefined,
			makeStorageStub("fixture", recorder),
		);
		await screen.findByTitle("fixture plugin");

		await view.router.navigate({ href: "/journal", replace: true });
		await screen.findByTitle("journal plugin");
		expect(recorder.setCalls).toEqual([]);

		await view.router.navigate({ href: "/settings", replace: true });
		await screen.findByRole("heading", { level: 1, name: "Settings" });

		fireEvent.click(screen.getByRole("button", { name: "Go back" }));
		await waitFor(() => expect(view.router.state.location.pathname).toBe("/fixture"));
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

	it("opens standalone God Mode from the server administration card", async () => {
		const view = mountView("/settings/account");
		const administration = await screen.findByRole("heading", { name: "Server administration" });
		const section = administration.closest("section");
		if (section === null) {
			throw new Error("Server administration heading must be inside a section");
		}
		expect(section.textContent).toContain("Requires an admin access token");

		fireEvent.click(within(section).getByRole("link", { name: /God Mode/ }));
		await screen.findByRole("heading", { name: "God Mode" });
		expect(view.router.state.location.pathname).toBe("/god-mode/users");
		expect(screen.queryByTestId("authenticated-shell")).toBeNull();
		expect(screen.queryByTestId("mobile-drawer")).toBeNull();
		expect(screen.queryByTitle("fixture plugin")).toBeNull();
	});

	it("disables both actions while sign out is pending and navigates to /auth on success", async () => {
		const gate = Effect.runSync(Deferred.make<boolean>());
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

		await Effect.runPromise(Deferred.succeed(gate, false));
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

describe("pro instance badge", () => {
	it("crowns the sidebar account avatar when the server key is validated", async () => {
		mountView("/settings/preferences", undefined, undefined, undefined, makePublicApiStub(true));
		const sidebar = await screen.findByTestId("desktop-sidebar");

		expect(within(sidebar).getByRole("img", { name: "Ryot Pro" })).not.toBeNull();
	});

	it("leaves the sidebar account avatar plain when the server key is not validated", async () => {
		mountView("/settings/preferences");
		const sidebar = await screen.findByTestId("desktop-sidebar");

		expect(within(sidebar).queryByRole("img", { name: "Ryot Pro" })).toBeNull();
	});

	it("falls back to the community badge when the system config cannot be read", async () => {
		mountView(
			"/settings/preferences",
			undefined,
			undefined,
			undefined,
			Layer.succeed(PublicApi, {
				checkHealth: () => Effect.void,
				getSystemConfig: () => Effect.fail(new PublicApiError({ cause: "offline" })),
			}),
		);
		const sidebar = await screen.findByTestId("desktop-sidebar");

		expect(within(sidebar).queryByRole("img", { name: "Ryot Pro" })).toBeNull();
		expect(screen.getByRole("heading", { name: "Preferences" })).not.toBeNull();
	});
});

const mainContents = () => document.querySelectorAll("#main-content");

describe("document title and skip-link target", () => {
	it("titles a literal kernel route and gives the skip link a single target", async () => {
		mountView("/", null, []);
		await screen.findByRole("heading", { name: "No workspaces enabled" });

		expect(document.title).toBe("No workspaces — Ryot");
		expect(mainContents()).toHaveLength(1);
	});

	it("titles an AuthStatus branch from the shared frame", async () => {
		mountView("/auth", undefined, undefined, makeAuthStub({}, unauthenticated));
		await screen.findByRole("heading", { name: "Opening sign-in" });

		expect(document.title).toBe("Opening sign-in — Ryot");
		expect(mainContents()).toHaveLength(1);
	});

	it("retitles when navigating between routes", async () => {
		const view = mountView("/settings/preferences");
		await screen.findByRole("heading", { name: "Preferences" });
		expect(document.title).toBe("Preferences — Ryot");

		await view.router.navigate({ href: "/settings/account" });
		await waitFor(() => expect(document.title).toBe("Account — Ryot"));
		expect(mainContents()).toHaveLength(1);
	});
});
