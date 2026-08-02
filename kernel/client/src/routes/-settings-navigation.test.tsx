import type { UpdateUserPreferencesBody } from "@ryot-app/contract/modules/user-settings/schemas";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Deferred, Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { KernelApiTestLayer, makeEntityInterestService } from "#/api/ports.test-layer";
import { PublicApi, PublicApiError } from "#/api/public";
import type { UserSettingsApi } from "#/api/user-settings";
import type { AuthService } from "#/modules/auth/service";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
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
	authenticated,
	userSettings,
	OAuthRouteStubs,
	makeStorageStub,
	unauthenticated,
	GodModeRouteStubs,
	makePublicApiStub,
	CustomizeRouteStubs,
	SavedViewRouteStubs,
	EntityRouteStubs,
	NavigationRouteStubs,
	ProviderAddRouteStubs,
	ImportsRouteStubs,
	IntegrationRouteStubs,
	NotificationChannelRouteStubs,
	makeOAuthRouteStubs,
	makeWorkspaceRecorder,
	makeUserSettingsStub,
	stubDesktopMatchMedia,
	ClientPagesApiRouteStubs,
	ClientPageSessionsRouteStubs,
} from "#/routes/-route-fixtures";

const AuthStub = makeAuthStub();

const mountView = (
	initialEntry: string | string[],
	rememberedSlug: string | null = "fixture",
	entries: PluginClientCatalog = catalog,
	authLayer: Layer.Layer<AuthService> = AuthStub,
	publicLayer = makePublicApiStub(),
	storage: ClientStorage["Service"] = makeStorageStub(rememberedSlug),
	userSettingsLayer: Layer.Layer<UserSettingsApi> = makeUserSettingsStub(),
	oauthLayer = OAuthRouteStubs,
) => {
	const events = makePluginCatalogEventsTestLayer();
	const interestEvents: string[] = [];
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProviderAddRouteStubs,
			ImportsRouteStubs,
			IntegrationRouteStubs,
			NotificationChannelRouteStubs,
			NotificationChannelRouteStubs,
			authLayer,
			GodModeRouteStubs,
			ServerStub,
			SavedViewRouteStubs,
			EntityRouteStubs,
			publicLayer,
			KernelApiTestLayer,
			ClientPagesApiRouteStubs,
			ClientPageSessionsRouteStubs,
			makeEntityInterestService({
				reconnect: () => {
					interestEvents.push("reconnect");
				},
				acquire: () => {
					interestEvents.push("acquire");
					return () => {
						interestEvents.push("release");
					};
				},
			}),
			userSettingsLayer,
			events.layer,
			Layer.succeed(PluginCatalogService, { load: () => Effect.succeed(entries) }),
			NavigationRouteStubs,
			CustomizeRouteStubs,
			Layer.succeed(PluginOperationsService, { invoke: () => Effect.die("not used") }),
			Layer.succeed(PluginQueriesService, { query: () => Effect.die("not used") }),
		).pipe(
			Layer.provideMerge(oauthLayer),
			Layer.provideMerge(Layer.succeed(ClientStorage, storage)),
		),
	);
	const initialEntries = typeof initialEntry === "string" ? [initialEntry] : initialEntry;
	const router = getRouter(
		{ theme, runtime, backInterceptors: createBackInterceptors() },
		createMemoryHistory({ initialEntries }),
	);
	const view = render(<RouterProvider router={router} />);
	return { ...view, router, interestEvents };
};

describe("authenticated route gate", () => {
	it("owns one interest session across loader revalidation and releases it on unmount without fetching preferences", async () => {
		let settingsReads = 0;
		const view = mountView(
			"/settings",
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			makeUserSettingsStub({
				get: () => {
					settingsReads++;
					return Effect.succeed(userSettings);
				},
			}),
		);
		await screen.findByRole("heading", { level: 1, name: "Settings" });
		expect(view.interestEvents).toEqual(["acquire"]);
		await view.router.invalidate();
		expect(view.interestEvents).toEqual(["acquire"]);
		expect(settingsReads).toBe(0);
		view.unmount();
		expect(view.interestEvents).toEqual(["acquire", "release"]);
	});
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

	it("frames a compact settings route with its own bar and no drawer", async () => {
		mountView("/settings/preferences");
		await screen.findByTestId("settings-sidebar");
		expect(screen.getByTestId("screen-frame-bar")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Go back" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Open navigation" })).toBeNull();
		expect(screen.queryByTestId("mobile-drawer")).toBeNull();
	});

	it("frames a desktop settings page with the title in content and no back control", async () => {
		const restore = stubDesktopMatchMedia();
		try {
			mountView("/settings/account");
			const heading = await screen.findByRole("heading", { level: 1, name: "Account" });

			expect(screen.queryByTestId("screen-frame-bar")).toBeNull();
			expect(heading.closest('[data-testid="screen-frame-bar"]')).toBeNull();
			expect(screen.queryByRole("button", { name: "Go back" })).toBeNull();
		} finally {
			restore();
		}
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
		await view.router.navigate({ replace: true, href: "/settings" });
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

		await view.router.navigate({ replace: true, href: "/journal" });
		await screen.findByTitle("journal plugin");
		expect(recorder.setCalls).toEqual([]);

		await view.router.navigate({ replace: true, href: "/settings" });
		await screen.findByRole("heading", { level: 1, name: "Settings" });

		fireEvent.click(screen.getByRole("button", { name: "Go back" }));
		await waitFor(() => expect(view.router.state.location.pathname).toBe("/fixture"));
	});
});

describe("account settings", () => {
	it("keeps demo account actions and information available", async () => {
		const demo = { ...authenticated, accessClass: "demo" as const };
		mountView(
			"/settings/account",
			undefined,
			undefined,
			makeAuthStub({}, demo),
			undefined,
			undefined,
			undefined,
			makeOAuthRouteStubs({}, {}, { isNative: true }),
		);

		const avatar = await screen.findByRole("button", { name: "New avatar" });
		expect(avatar.hasAttribute("disabled")).toBe(false);
		expect(screen.getByRole("button", { name: "Sign out" }).hasAttribute("disabled")).toBe(false);
		expect(screen.getByRole("heading", { name: "Server" })).not.toBeNull();
		expect(screen.getByRole("link", { name: /God Mode/ })).not.toBeNull();
	});

	it("retries a failed account identity query", async () => {
		let sessionReads = 0;
		mountView(
			"/settings/account",
			undefined,
			undefined,
			makeAuthStub({
				settledSession: () => {
					sessionReads++;
					return sessionReads === 2
						? Effect.die("account unavailable")
						: Effect.succeed(authenticated);
				},
			}),
		);

		await screen.findByText("Could not load your account.");
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));

		await screen.findByRole("button", { name: "New avatar" });
		expect(sessionReads).toBe(3);
	});

	it("renders the current identity: name, email, and user ID", async () => {
		mountView("/settings/account");
		await screen.findByRole("button", { name: "New avatar" });

		const profile = screen.getByRole("heading", { name: "Profile" }).closest("section");
		expect(profile).not.toBeNull();
		expect(profile?.textContent).toContain("Test User");
		expect(profile?.textContent).toContain("user@ryot.example");
		expect(profile?.textContent).toContain("ID: user-1");
		expect(profile?.textContent).not.toContain("https://ryot.example");
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

	it("names the connected server on native and points at sign out to change it", async () => {
		mountView(
			"/settings/account",
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			makeOAuthRouteStubs({}, {}, { isNative: true }),
		);
		await screen.findByRole("heading", { name: "Account" });

		const section = screen.getByRole("heading", { name: "Server" }).closest("section");
		expect(section?.textContent).toContain("https://ryot.example");
		expect(section?.textContent).toContain(
			"Sign out to connect this device to a different server.",
		);
	});

	it("hides the server section on web, where the origin cannot be changed", async () => {
		mountView("/settings/account");
		await screen.findByRole("heading", { name: "Account" });

		expect(screen.queryByRole("heading", { name: "Server" })).toBeNull();
	});

	it("generates a new avatar and forces the session to refresh", async () => {
		const refreshes: boolean[] = [];
		const generated: string[] = [];
		mountView(
			"/settings/account",
			undefined,
			undefined,
			makeAuthStub({
				settledSession: (_origin, forceRefresh = false) =>
					Effect.sync(() => {
						refreshes.push(forceRefresh);
						return authenticated;
					}),
			}),
			undefined,
			undefined,
			makeUserSettingsStub({
				refreshAvatar: () =>
					Effect.sync(() => {
						generated.push("https://ryot.example/avatar.png");
						return { image: "https://ryot.example/avatar.png" };
					}),
			}),
		);
		await screen.findByRole("button", { name: "New avatar" });
		const readsBeforeGenerate = refreshes.filter((forceRefresh) => !forceRefresh).length;

		fireEvent.click(screen.getByRole("button", { name: "New avatar" }));

		await waitFor(() => {
			expect(refreshes).toContain(true);
			expect(refreshes.filter((forceRefresh) => !forceRefresh).length).toBeGreaterThan(
				readsBeforeGenerate,
			);
		});
		expect(generated).toEqual(["https://ryot.example/avatar.png"]);
	});

	it("disables the avatar action while it is pending", async () => {
		const gate = Effect.runSync(Deferred.make<{ image: string }>());
		mountView(
			"/settings/account",
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			makeUserSettingsStub({ refreshAvatar: () => Deferred.await(gate) }),
		);
		await screen.findByRole("button", { name: "New avatar" });

		fireEvent.click(screen.getByRole("button", { name: "New avatar" }));

		const pending = await screen.findByRole("button", { name: "Generating..." });
		expect(pending.hasAttribute("disabled")).toBe(true);
		await Effect.runPromise(Deferred.succeed(gate, { image: "https://ryot.example/avatar.png" }));
		await screen.findByRole("button", { name: "New avatar" });
	});

	it("reports a failed avatar generation and leaves the action available", async () => {
		mountView(
			"/settings/account",
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			makeUserSettingsStub({ refreshAvatar: () => Effect.die("avatar generation failed") }),
		);
		await screen.findByRole("button", { name: "New avatar" });

		fireEvent.click(screen.getByRole("button", { name: "New avatar" }));

		await screen.findByText("Could not generate a new avatar. Try again.");
		expect(screen.getByRole("button", { name: "New avatar" }).hasAttribute("disabled")).toBe(false);
	});

	it("disables sign out while it is pending and navigates to /auth on success", async () => {
		const gate = Effect.runSync(Deferred.make<boolean>());
		const view = mountView(
			"/settings/account",
			undefined,
			undefined,
			makeAuthStub({ signOut: () => Deferred.await(gate) }),
		);
		await screen.findByRole("heading", { name: "Account" });

		fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
		const pending = await screen.findByRole("button", { name: "Signing out..." });
		expect(pending.hasAttribute("disabled")).toBe(true);

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

		await screen.findByText("Could not sign out.");
		expect(view.router.state.location.pathname).toBe("/settings/account");
		expect(screen.getByRole("button", { name: "Sign out" }).hasAttribute("disabled")).toBe(false);
	});

	it("leaves navigation to an external logout without refreshing account data", async () => {
		const signOuts: string[] = [];
		let sessionReads = 0;
		const view = mountView(
			"/settings/account",
			undefined,
			undefined,
			makeAuthStub({
				signOut: (origin) =>
					Effect.sync(() => {
						signOuts.push(origin);
						return true;
					}),
				settledSession: () =>
					Effect.sync(() => {
						sessionReads++;
						return authenticated;
					}),
			}),
		);
		await screen.findByRole("button", { name: "Sign out" });
		const readsBeforeSignOut = sessionReads;

		fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

		await waitFor(() => expect(signOuts).toEqual([server]));
		await screen.findByRole("button", { name: "Sign out" });
		expect(view.router.state.location.pathname).toBe("/settings/account");
		expect(sessionReads).toBe(readsBeforeSignOut);
	});
});

describe("preferences settings", () => {
	const mountPreferences = (
		userSettingsLayer = makeUserSettingsStub(),
		authLayer: Layer.Layer<AuthService> = AuthStub,
	) =>
		mountView(
			"/settings/preferences",
			undefined,
			undefined,
			authLayer,
			undefined,
			undefined,
			userSettingsLayer,
		);

	it("keeps local appearance usable and makes demo server preferences read-only", async () => {
		let saves = 0;
		mountPreferences(
			makeUserSettingsStub({
				updatePreferences: () =>
					Effect.sync(() => {
						saves++;
						return userSettings.preferences;
					}),
			}),
			makeAuthStub({}, { ...authenticated, accessClass: "demo" }),
		);

		await screen.findByText("This operation is unavailable while using the shared demo account.");
		expect(screen.getByRole("switch", { name: "Show NSFW content" }).hasAttribute("disabled")).toBe(
			true,
		);
		expect(
			screen.getByRole("switch", { name: "Disable integrations" }).hasAttribute("disabled"),
		).toBe(true);
		expect(
			screen
				.getByRole("button", { name: "Metadata language: Provider default" })
				.hasAttribute("disabled"),
		).toBe(true);
		expect(screen.getByRole("button", { name: "Save changes" }).hasAttribute("disabled")).toBe(
			true,
		);
		const appearance = within(screen.getByRole("radiogroup", { name: "Appearance" })).getAllByRole(
			"radio",
		)[0];
		expect(appearance.hasAttribute("disabled")).toBe(false);
		expect(saves).toBe(0);
	});

	it("renders appearance beside the server-backed preferences", async () => {
		mountPreferences();
		await screen.findByRole("switch", { name: "Show NSFW content" });

		expect(screen.getByRole("radiogroup", { name: "Appearance" })).not.toBeNull();
		expect(screen.getByRole("switch", { name: "Show NSFW content" })).not.toBeNull();
		expect(screen.getByRole("switch", { name: "Disable integrations" })).not.toBeNull();
		expect(
			screen.getByRole("button", { name: "Metadata language: Provider default" }),
		).not.toBeNull();
	});

	it("submits only the changed preferences and reports the save", async () => {
		const saved: UpdateUserPreferencesBody[] = [];
		let settingsReads = 0;
		let current = userSettings;
		const view = mountPreferences(
			makeUserSettingsStub({
				get: () =>
					Effect.sync(() => {
						settingsReads++;
						return current;
					}),
				updatePreferences: (_scope, request) =>
					Effect.sync(() => {
						saved.push(request.payload);
						current = { ...current, preferences: { ...current.preferences, ...request.payload } };
						return current.preferences;
					}),
			}),
		);
		const submit = await screen.findByRole("button", { name: "Save changes" });
		expect(submit.hasAttribute("disabled")).toBe(true);

		fireEvent.click(screen.getByRole("switch", { name: "Show NSFW content" }));
		expect(submit.hasAttribute("disabled")).toBe(false);
		fireEvent.click(submit);

		await screen.findByText("Preferences saved.");
		await waitFor(() => expect(settingsReads).toBe(2));
		expect(saved).toEqual([{ allowNsfw: true }]);
		expect(view.interestEvents).toEqual(["acquire"]);
		expect(screen.getByRole("button", { name: "Save changes" }).hasAttribute("disabled")).toBe(
			true,
		);
	});

	it("submits a metadata language picked from the options", async () => {
		const saved: UpdateUserPreferencesBody[] = [];
		const view = mountPreferences(
			makeUserSettingsStub({
				updatePreferences: (_scope, request) =>
					Effect.sync(() => {
						saved.push(request.payload);
						return { ...userSettings.preferences, ...request.payload };
					}),
			}),
		);
		await screen.findByRole("button", { name: "Save changes" });

		fireEvent.click(screen.getByRole("button", { name: "Metadata language: Provider default" }));
		fireEvent.click(screen.getByRole("radio", { name: "Spanish" }));
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await screen.findByText("Preferences saved.");
		expect(saved).toEqual([{ language: "es" }]);
		expect(view.interestEvents).toEqual(["acquire", "reconnect"]);
	});

	it("disables preference controls while a save is pending", async () => {
		const gate = Effect.runSync(Deferred.make<typeof userSettings.preferences>());
		mountPreferences(makeUserSettingsStub({ updatePreferences: () => Deferred.await(gate) }));
		await screen.findByRole("button", { name: "Save changes" });
		fireEvent.click(screen.getByRole("switch", { name: "Show NSFW content" }));
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		const savingButton = await screen.findByRole("button", { name: "Saving..." });
		expect(savingButton.hasAttribute("disabled")).toBe(true);
		expect(screen.getByRole("switch", { name: "Show NSFW content" }).hasAttribute("disabled")).toBe(
			true,
		);
		expect(
			screen.getByRole("switch", { name: "Disable integrations" }).hasAttribute("disabled"),
		).toBe(true);
		expect(
			screen
				.getByRole("button", { name: "Metadata language: Provider default" })
				.hasAttribute("disabled"),
		).toBe(true);

		await Effect.runPromise(
			Deferred.succeed(gate, { ...userSettings.preferences, allowNsfw: true }),
		);
		await screen.findByText("Preferences saved.");
	});

	it("does not reconnect when a metadata language save fails", async () => {
		const view = mountPreferences(
			makeUserSettingsStub({ updatePreferences: () => Effect.die("save failed") }),
		);
		await screen.findByRole("button", { name: "Save changes" });
		fireEvent.click(screen.getByRole("button", { name: "Metadata language: Provider default" }));
		fireEvent.click(screen.getByRole("radio", { name: "Spanish" }));
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await screen.findByText("Could not save preferences. Try again.");
		expect(view.interestEvents).toEqual(["acquire"]);
	});

	it("keeps the edit available and explains a failed save", async () => {
		mountPreferences(
			makeUserSettingsStub({ updatePreferences: () => Effect.die("preference update failed") }),
		);
		await screen.findByRole("button", { name: "Save changes" });

		fireEvent.click(screen.getByRole("switch", { name: "Disable integrations" }));
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await screen.findByText("Could not save preferences. Try again.");
		expect(
			screen.getByRole("switch", { name: "Disable integrations" }).getAttribute("aria-checked"),
		).toBe("true");
		expect(screen.getByRole("button", { name: "Save changes" }).hasAttribute("disabled")).toBe(
			false,
		);
	});

	it("keeps preferences visible when their mutation refresh fails", async () => {
		let settingsReads = 0;
		mountPreferences(
			makeUserSettingsStub({
				updatePreferences: (_scope, request) =>
					Effect.succeed({ ...userSettings.preferences, ...request.payload }),
				get: () => {
					settingsReads++;
					return settingsReads === 1
						? Effect.succeed(userSettings)
						: Effect.die("settings refresh failed");
				},
			}),
		);
		const nsfw = await screen.findByRole("switch", { name: "Show NSFW content" });

		fireEvent.click(nsfw);
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await screen.findByText("Preferences saved.");
		await waitFor(() => expect(settingsReads).toBe(2));
		expect(screen.getByRole("switch", { name: "Show NSFW content" })).toBe(nsfw);
		expect(
			screen.queryByText("Could not load your settings. Check the server and try again."),
		).toBeNull();
	});

	it("keeps appearance usable when the settings request fails", async () => {
		mountPreferences(makeUserSettingsStub({ get: () => Effect.die("settings unavailable") }));
		await screen.findByRole("heading", { name: "Preferences" });

		expect(screen.getByRole("radiogroup", { name: "Appearance" })).not.toBeNull();
		await screen.findByText("Could not load your settings. Check the server and try again.");
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

		await waitFor(() => expect(document.title).toBe("No workspaces — Ryot"));
		expect(mainContents()).toHaveLength(1);
	});

	it("titles an AuthStatus branch from the shared frame", async () => {
		mountView("/auth", undefined, undefined, makeAuthStub({}, unauthenticated));
		await screen.findByRole("heading", { name: "Opening sign-in" });

		await waitFor(() => expect(document.title).toBe("Opening sign-in — Ryot"));
		expect(mainContents()).toHaveLength(1);
	});

	it("retitles when navigating between routes", async () => {
		const view = mountView("/settings/preferences");
		await screen.findByRole("heading", { name: "Preferences" });
		await waitFor(() => expect(document.title).toBe("Preferences — Ryot"));

		await view.router.navigate({ href: "/settings/account" });
		await waitFor(() => expect(document.title).toBe("Account — Ryot"));
		expect(mainContents()).toHaveLength(1);
	});
});
