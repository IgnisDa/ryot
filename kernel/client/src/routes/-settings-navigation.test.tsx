import { describe, expect, it } from "@effect/vitest";
import type { UpdateUserPreferencesBody } from "@ryot-app/contract/modules/user-settings/schemas";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Deferred, Effect, Layer, ManagedRuntime } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import {
	KernelApiTestLayer,
	makeEntityInterestService,
	makeRyotQLApi,
} from "#/api/ports.test-layer";
import { PublicApi, PublicApiError } from "#/api/public";
import type { RyotQLApi } from "#/api/ryotql";
import type { UserSettingsApi } from "#/api/user-settings";
import type { AuthService } from "#/modules/auth/service";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/events.test-layer";
import {
	makePluginCatalog,
	makePluginOperations,
	makePluginQueries,
} from "#/modules/plugins/services.test-layer";
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

const makeUserSettingsQueries = (get: () => typeof userSettings = () => userSettings) =>
	makeRyotQLApi({
		execute: (_scope, request) => {
			if (!("user" in request.payload.queries)) {
				return Effect.die("Unexpected RyotQL document");
			}
			return Effect.try({ try: get, catch: (cause) => new AuthenticatedApiError({ cause }) }).pipe(
				Effect.map((settings) => ({
					data: {
						user: {
							items: [settings],
							type: "rows" as const,
							pageInfo: { limit: 1, hasMore: false, nextCursor: null },
						},
					},
				})),
			);
		},
	});

const mountView = (
	initialEntry: string | string[],
	rememberedSlug: string | null = "fixture",
	entries: PluginClientCatalog = catalog,
	authLayer: Layer.Layer<AuthService> = AuthStub,
	publicLayer = makePublicApiStub(),
	storage: ClientStorage["Service"] = makeStorageStub(rememberedSlug),
	userSettingsLayer: Layer.Layer<UserSettingsApi> = makeUserSettingsStub(),
	oauthLayer = OAuthRouteStubs,
	settingsQueries: Layer.Layer<RyotQLApi> = makeUserSettingsQueries(),
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
			settingsQueries,
			events.layer,
			makePluginCatalog(entries),
			NavigationRouteStubs,
			CustomizeRouteStubs,
			makePluginOperations(),
			makePluginQueries(),
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
	it.live(
		"owns one interest session across loader revalidation and releases it on unmount without fetching preferences",
		() =>
			Effect.gen(function* () {
				let settingsReads = 0;
				const view = mountView(
					"/settings",
					undefined,
					undefined,
					undefined,
					undefined,
					undefined,
					makeUserSettingsStub(),
					undefined,
					makeUserSettingsQueries(() => {
						settingsReads++;
						return userSettings;
					}),
				);
				yield* Effect.promise(() => screen.findByRole("heading", { level: 1, name: "Settings" }));
				expect(view.interestEvents).toEqual(["acquire"]);
				yield* Effect.promise(() => view.router.invalidate());
				expect(view.interestEvents).toEqual(["acquire"]);
				expect(settingsReads).toBe(0);
				view.unmount();
				expect(view.interestEvents).toEqual(["acquire", "release"]);
			}),
	);
	it.live.each(["/", "/fixture", "/settings", "/settings/preferences", "/settings/account"])(
		"redirects an unauthenticated visitor from %s to /auth",
		(path) =>
			Effect.gen(function* () {
				const view = mountView(path, undefined, undefined, makeAuthStub({}, unauthenticated));
				yield* Effect.promise(() =>
					waitFor(() => expect(view.router.state.location.pathname).toBe("/auth")),
				);
				expect(view.router.state.location.search.redirect).toBe(path);
			}),
	);
});

describe("settings navigation", () => {
	it.live("marks the active section on the desktop settings sidebar", () =>
		Effect.gen(function* () {
			const view = mountView("/settings/preferences");
			const sidebar = yield* Effect.promise(() => screen.findByTestId("settings-sidebar"));
			const preferences = within(sidebar).getByRole("link", { name: "Preferences" });
			const account = within(sidebar).getByRole("link", { name: "Account" });

			expect(preferences.getAttribute("aria-current")).toBe("page");
			expect(preferences.getAttribute("class")).toContain("bg-nav-indicator");
			expect(account.getAttribute("aria-current")).toBeNull();

			yield* Effect.promise(() => view.router.navigate({ href: "/settings/account" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.pathname).toBe("/settings/account")),
			);
			const accountAfterNavigate = within(screen.getByTestId("settings-sidebar")).getByRole(
				"link",
				{ name: "Account" },
			);
			expect(accountAfterNavigate.getAttribute("aria-current")).toBe("page");
			expect(accountAfterNavigate.getAttribute("class")).toContain("bg-nav-indicator");
		}),
	);

	it.live("navigates with replace when selecting a section from the desktop sidebar", () =>
		Effect.gen(function* () {
			const view = mountView(["/fixture", "/settings/preferences"]);
			const sidebar = yield* Effect.promise(() => screen.findByTestId("settings-sidebar"));

			fireEvent.click(within(sidebar).getByRole("link", { name: "Account" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.pathname).toBe("/settings/account")),
			);

			view.router.history.back();
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.pathname).toBe("/fixture")),
			);
		}),
	);

	it.live("keeps an unmatched settings path inside the settings layout", () =>
		Effect.gen(function* () {
			const view = mountView("/settings/account/security");
			const sidebar = yield* Effect.promise(() => screen.findByTestId("settings-sidebar"));

			expect(view.router.state.location.pathname).toBe("/settings/account/security");
			expect(screen.getByRole("status").textContent).toBe("This page does not exist.");
			expect(screen.queryByTitle("fixture plugin")).toBeNull();
			expect(
				within(sidebar).getByRole("link", { name: "Account" }).getAttribute("aria-current"),
			).toBe("page");
		}),
	);

	it.live("renders the mobile settings index with disclosure rows and pushes on selection", () =>
		Effect.gen(function* () {
			const view = mountView("/settings");
			yield* Effect.promise(() => screen.findByRole("heading", { level: 1, name: "Settings" }));
			const sections = screen.getByTestId("settings-index-sections");
			const preferences = within(sections).getByRole("link", { name: "Preferences" });
			expect(preferences.querySelector('[data-app-icon="chevron-right"]')).not.toBeNull();

			fireEvent.click(preferences);
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.pathname).toBe("/settings/preferences")),
			);

			view.router.history.back();
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.pathname).toBe("/settings")),
			);
		}),
	);

	it.live(
		"replaces to preferences on desktop when /settings crosses into the desktop breakpoint",
		() => {
			const restore = stubDesktopMatchMedia();
			return Effect.gen(function* () {
				const view = mountView("/settings");
				yield* Effect.promise(() =>
					waitFor(() => expect(view.router.state.location.pathname).toBe("/settings/preferences")),
				);
			}).pipe(Effect.ensuring(Effect.sync(restore)));
		},
	);

	it.live("frames a compact settings route with its own bar and no drawer", () =>
		Effect.gen(function* () {
			mountView("/settings/preferences");
			yield* Effect.promise(() => screen.findByTestId("settings-sidebar"));
			expect(screen.getByTestId("screen-frame-bar")).toBeTruthy();
			expect(screen.getByRole("button", { name: "Go back" })).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Open navigation" })).toBeNull();
			expect(screen.queryByTestId("mobile-drawer")).toBeNull();
		}),
	);

	it.live("frames a desktop settings page with the title in content and no back control", () => {
		const restore = stubDesktopMatchMedia();
		return Effect.gen(function* () {
			mountView("/settings/account");
			const heading = yield* Effect.promise(() =>
				screen.findByRole("heading", { level: 1, name: "Account" }),
			);

			expect(screen.queryByTestId("screen-frame-bar")).toBeNull();
			expect(heading.closest('[data-testid="screen-frame-bar"]')).toBeNull();
			expect(screen.queryByRole("button", { name: "Go back" })).toBeNull();
		}).pipe(Effect.ensuring(Effect.sync(restore)));
	});

	it.live(
		"returns to the previous entry when back is used after navigating into a detail route",
		() =>
			Effect.gen(function* () {
				const view = mountView(["/fixture", "/settings"]);
				yield* Effect.promise(() => screen.findByRole("heading", { level: 1, name: "Settings" }));
				const sections = screen.getByTestId("settings-index-sections");

				fireEvent.click(within(sections).getByRole("link", { name: "Preferences" }));
				yield* Effect.promise(() =>
					waitFor(() => expect(view.router.state.location.pathname).toBe("/settings/preferences")),
				);

				fireEvent.click(screen.getByRole("button", { name: "Go back" }));
				yield* Effect.promise(() =>
					waitFor(() => expect(view.router.state.location.pathname).toBe("/settings")),
				);
			}),
	);

	it.live("replaces to /settings on direct entry to a detail route", () =>
		Effect.gen(function* () {
			const view = mountView("/settings/preferences");
			yield* Effect.promise(() => screen.findByRole("heading", { name: "Preferences" }));

			fireEvent.click(screen.getByRole("button", { name: "Go back" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.pathname).toBe("/settings")),
			);
			expect(view.router.history.canGoBack()).toBe(false);
		}),
	);

	it.live("replaces to the remembered workspace route on direct entry to /settings", () =>
		Effect.gen(function* () {
			const view = mountView("/settings", "fixture");
			yield* Effect.promise(() => screen.findByRole("heading", { level: 1, name: "Settings" }));

			fireEvent.click(screen.getByRole("button", { name: "Go back" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.pathname).toBe("/fixture")),
			);
			expect(view.router.history.canGoBack()).toBe(false);
		}),
	);

	it.live("falls back to a workspace chosen during the current shell lifetime", () =>
		Effect.gen(function* () {
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
			yield* Effect.promise(() => screen.findByTitle("fixture plugin"));

			fireEvent.click(screen.getByRole("button", { name: "Fixture workspace, fixture" }));
			fireEvent.click(screen.getByRole("menuitemradio", { name: "Switch to Journal workspace" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(recorder.setCalls).toEqual([
						{ slug: "journal", scope: { serverUrl: server, userId: authenticated.user.id } },
					]),
				),
			);
			yield* Effect.promise(() => view.router.navigate({ replace: true, href: "/settings" }));
			yield* Effect.promise(() => screen.findByRole("heading", { level: 1, name: "Settings" }));

			fireEvent.click(screen.getByRole("button", { name: "Go back" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.pathname).toBe("/journal")),
			);
			expect(view.router.history.canGoBack()).toBe(false);
		}),
	);

	it.live("does not adopt a workspace reached only by its direct route", () =>
		Effect.gen(function* () {
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
			yield* Effect.promise(() => screen.findByTitle("fixture plugin"));

			yield* Effect.promise(() => view.router.navigate({ replace: true, href: "/journal" }));
			yield* Effect.promise(() => screen.findByTitle("journal plugin"));
			expect(recorder.setCalls).toEqual([]);

			yield* Effect.promise(() => view.router.navigate({ replace: true, href: "/settings" }));
			yield* Effect.promise(() => screen.findByRole("heading", { level: 1, name: "Settings" }));

			fireEvent.click(screen.getByRole("button", { name: "Go back" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.pathname).toBe("/fixture")),
			);
		}),
	);
});

describe("account settings", () => {
	it.live("keeps demo account actions and information available", () =>
		Effect.gen(function* () {
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

			const avatar = yield* Effect.promise(() =>
				screen.findByRole("button", { name: "New avatar" }),
			);
			expect(avatar.hasAttribute("disabled")).toBe(false);
			expect(screen.getByRole("button", { name: "Sign out" }).hasAttribute("disabled")).toBe(false);
			expect(screen.getByRole("heading", { name: "Server" })).not.toBeNull();
			expect(screen.getByRole("link", { name: /God Mode/ })).not.toBeNull();
		}),
	);

	it.live("retries a failed account identity query", () =>
		Effect.gen(function* () {
			let sessionReads = 0;
			let retry = false;
			mountView(
				"/settings/account",
				undefined,
				undefined,
				makeAuthStub({
					settledSession: () => {
						sessionReads++;
						return sessionReads > 1 && !retry
							? Effect.die("account unavailable")
							: Effect.succeed(authenticated);
					},
				}),
			);

			yield* Effect.promise(() => screen.findByText("Could not load your account."));
			retry = true;
			fireEvent.click(screen.getByRole("button", { name: "Try again" }));

			yield* Effect.promise(() => screen.findByRole("button", { name: "New avatar" }));
			expect(sessionReads).toBeGreaterThan(2);
		}),
	);

	it.live("renders the current identity: name, email, and user ID", () =>
		Effect.gen(function* () {
			mountView("/settings/account");
			yield* Effect.promise(() => screen.findByRole("button", { name: "New avatar" }));

			const profile = screen.getByRole("heading", { name: "Profile" }).closest("section");
			expect(profile).not.toBeNull();
			expect(profile?.textContent).toContain("Test User");
			expect(profile?.textContent).toContain("user@ryot.example");
			expect(profile?.textContent).toContain("ID: user-1");
			expect(profile?.textContent).not.toContain("https://ryot.example");
		}),
	);

	it.live("opens standalone God Mode from the server administration card", () =>
		Effect.gen(function* () {
			const view = mountView("/settings/account");
			const administration = yield* Effect.promise(() =>
				screen.findByRole("heading", { name: "Server administration" }),
			);
			const section = administration.closest("section");
			if (section === null) {
				throw new Error("Server administration heading must be inside a section");
			}
			expect(section.textContent).toContain("Requires an admin access token");

			fireEvent.click(within(section).getByRole("link", { name: /God Mode/ }));
			yield* Effect.promise(() => screen.findByRole("heading", { name: "God Mode" }));
			expect(view.router.state.location.pathname).toBe("/god-mode/users");
			expect(screen.queryByTestId("authenticated-shell")).toBeNull();
			expect(screen.queryByTestId("mobile-drawer")).toBeNull();
			expect(screen.queryByTitle("fixture plugin")).toBeNull();
		}),
	);

	it.live("names the connected server on native and points at sign out to change it", () =>
		Effect.gen(function* () {
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
			yield* Effect.promise(() => screen.findByRole("heading", { name: "Account" }));

			const section = screen.getByRole("heading", { name: "Server" }).closest("section");
			expect(section?.textContent).toContain("https://ryot.example");
			expect(section?.textContent).toContain(
				"Sign out to connect this device to a different server.",
			);
		}),
	);

	it.live("hides the server section on web, where the origin cannot be changed", () =>
		Effect.gen(function* () {
			mountView("/settings/account");
			yield* Effect.promise(() => screen.findByRole("heading", { name: "Account" }));

			expect(screen.queryByRole("heading", { name: "Server" })).toBeNull();
		}),
	);

	it.live("generates a new avatar and forces the session to refresh", () =>
		Effect.gen(function* () {
			const refreshes: boolean[] = [];
			let avatar: string | null = null;
			mountView(
				"/settings/account",
				undefined,
				undefined,
				makeAuthStub({
					settledSession: (_origin, forceRefresh = false) =>
						Effect.sync(() => {
							refreshes.push(forceRefresh);
							return { ...authenticated, user: { ...authenticated.user, image: avatar } };
						}),
				}),
				undefined,
				undefined,
				makeUserSettingsStub({
					refreshAvatar: () =>
						Effect.sync(() => {
							avatar = "https://ryot.example/avatar.png";
						}),
				}),
			);
			yield* Effect.promise(() => screen.findByRole("button", { name: "New avatar" }));
			const readsBeforeGenerate = refreshes.filter((forceRefresh) => !forceRefresh).length;

			fireEvent.click(screen.getByRole("button", { name: "New avatar" }));

			yield* Effect.promise(() =>
				waitFor(() => {
					expect(refreshes).toContain(true);
					expect(refreshes.filter((forceRefresh) => !forceRefresh).length).toBeGreaterThan(
						readsBeforeGenerate,
					);
				}),
			);
			expect(screen.getByRole("img", { name: "Test User's avatar" }).getAttribute("src")).toBe(
				"https://ryot.example/avatar.png",
			);
		}),
	);

	it.live("disables the avatar action while it is pending", () =>
		Effect.gen(function* () {
			const gate = Deferred.makeUnsafe<void>();
			mountView(
				"/settings/account",
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				makeUserSettingsStub({ refreshAvatar: () => Deferred.await(gate) }),
			);
			yield* Effect.promise(() => screen.findByRole("button", { name: "New avatar" }));

			fireEvent.click(screen.getByRole("button", { name: "New avatar" }));

			const pending = yield* Effect.promise(() =>
				screen.findByRole("button", { name: "Generating..." }),
			);
			expect(pending.hasAttribute("disabled")).toBe(true);
			yield* Deferred.succeed(gate, undefined);
			yield* Effect.promise(() => screen.findByRole("button", { name: "New avatar" }));
		}),
	);

	it.live("reports a failed avatar generation and leaves the action available", () =>
		Effect.gen(function* () {
			mountView(
				"/settings/account",
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				makeUserSettingsStub({ refreshAvatar: () => Effect.die("avatar generation failed") }),
			);
			yield* Effect.promise(() => screen.findByRole("button", { name: "New avatar" }));

			fireEvent.click(screen.getByRole("button", { name: "New avatar" }));

			yield* Effect.promise(() => screen.findByText("Could not generate a new avatar. Try again."));
			expect(screen.getByRole("button", { name: "New avatar" }).hasAttribute("disabled")).toBe(
				false,
			);
		}),
	);

	it.live("keeps the account visible if refreshing the session after avatar generation fails", () =>
		Effect.gen(function* () {
			mountView(
				"/settings/account",
				undefined,
				undefined,
				makeAuthStub({
					settledSession: (_origin, forceRefresh = false) =>
						forceRefresh ? Effect.die("session refresh failed") : Effect.succeed(authenticated),
				}),
				undefined,
				undefined,
				makeUserSettingsStub({ refreshAvatar: () => Effect.void }),
			);
			yield* Effect.promise(() => screen.findByRole("button", { name: "New avatar" }));

			fireEvent.click(screen.getByRole("button", { name: "New avatar" }));

			yield* Effect.promise(() => screen.findByText("Could not generate a new avatar. Try again."));
			const profile = screen.getByRole("heading", { name: "Profile" }).closest("section");
			expect(profile?.textContent).toContain("user@ryot.example");
			expect(screen.getByRole("button", { name: "New avatar" }).hasAttribute("disabled")).toBe(
				false,
			);
		}),
	);

	it.live("disables sign out while it is pending and navigates to /auth on success", () =>
		Effect.gen(function* () {
			const gate = Deferred.makeUnsafe<boolean>();
			const view = mountView(
				"/settings/account",
				undefined,
				undefined,
				makeAuthStub({ signOut: () => Deferred.await(gate) }),
			);
			yield* Effect.promise(() => screen.findByRole("heading", { name: "Account" }));

			fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
			const pending = yield* Effect.promise(() =>
				screen.findByRole("button", { name: "Signing out..." }),
			);
			expect(pending.hasAttribute("disabled")).toBe(true);

			yield* Deferred.succeed(gate, false);
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.pathname).toBe("/auth")),
			);
		}),
	);

	it.live("stays put and renders a stable failure message when sign out fails", () =>
		Effect.gen(function* () {
			const view = mountView(
				"/settings/account",
				undefined,
				undefined,
				makeAuthStub({ signOut: () => Effect.die("sign out failed") }),
			);
			yield* Effect.promise(() => screen.findByRole("heading", { name: "Account" }));

			fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

			yield* Effect.promise(() => screen.findByText("Could not sign out."));
			expect(view.router.state.location.pathname).toBe("/settings/account");
			expect(screen.getByRole("button", { name: "Sign out" }).hasAttribute("disabled")).toBe(false);
		}),
	);

	it.live("leaves navigation to an external logout without refreshing account data", () =>
		Effect.gen(function* () {
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
			yield* Effect.promise(() => screen.findByRole("button", { name: "Sign out" }));
			const readsBeforeSignOut = sessionReads;

			fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

			yield* Effect.promise(() => waitFor(() => expect(signOuts).toEqual([server])));
			yield* Effect.promise(() => screen.findByRole("button", { name: "Sign out" }));
			expect(view.router.state.location.pathname).toBe("/settings/account");
			expect(sessionReads).toBe(readsBeforeSignOut);
		}),
	);
});

const mountPreferences = (
	userSettingsLayer = makeUserSettingsStub(),
	authLayer: Layer.Layer<AuthService> = AuthStub,
	settingsQueries: Layer.Layer<RyotQLApi> = makeUserSettingsQueries(),
) =>
	mountView(
		"/settings/preferences",
		undefined,
		undefined,
		authLayer,
		undefined,
		undefined,
		userSettingsLayer,
		undefined,
		settingsQueries,
	);

describe("preferences settings", () => {
	it.live("keeps local appearance usable and makes demo server preferences read-only", () =>
		Effect.gen(function* () {
			let saves = 0;
			mountPreferences(
				makeUserSettingsStub({
					updatePreferences: () =>
						Effect.sync(() => {
							saves++;
						}),
				}),
				makeAuthStub({}, { ...authenticated, accessClass: "demo" }),
			);

			yield* Effect.promise(() =>
				screen.findByText("This operation is unavailable while using the shared demo account."),
			);
			expect(
				screen.getByRole("switch", { name: "Show NSFW content" }).hasAttribute("disabled"),
			).toBe(true);
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
			const appearance = within(
				screen.getByRole("radiogroup", { name: "Appearance" }),
			).getAllByRole("radio")[0];
			expect(appearance.hasAttribute("disabled")).toBe(false);
			expect(saves).toBe(0);
		}),
	);

	it.live("renders appearance beside the server-backed preferences", () =>
		Effect.gen(function* () {
			mountPreferences();
			yield* Effect.promise(() => screen.findByRole("switch", { name: "Show NSFW content" }));

			expect(screen.getByRole("radiogroup", { name: "Appearance" })).not.toBeNull();
			expect(screen.getByRole("switch", { name: "Show NSFW content" })).not.toBeNull();
			expect(screen.getByRole("switch", { name: "Disable integrations" })).not.toBeNull();
			expect(
				screen.getByRole("button", { name: "Metadata language: Provider default" }),
			).not.toBeNull();
		}),
	);

	it.live("submits only the changed preferences and reports the save", () =>
		Effect.gen(function* () {
			const saved: UpdateUserPreferencesBody[] = [];
			let settingsReads = 0;
			let current = userSettings;
			const view = mountPreferences(
				makeUserSettingsStub({
					updatePreferences: (_scope, request) =>
						Effect.sync(() => {
							saved.push(request.payload);
							current = { ...current, preferences: { ...current.preferences, ...request.payload } };
						}),
				}),
				undefined,
				makeUserSettingsQueries(() => {
					settingsReads++;
					return current;
				}),
			);
			const submit = yield* Effect.promise(() =>
				screen.findByRole("button", { name: "Save changes" }),
			);
			expect(submit.hasAttribute("disabled")).toBe(true);

			fireEvent.click(screen.getByRole("switch", { name: "Show NSFW content" }));
			expect(submit.hasAttribute("disabled")).toBe(false);
			fireEvent.click(submit);

			yield* Effect.promise(() => screen.findByText("Preferences saved."));
			yield* Effect.promise(() => waitFor(() => expect(settingsReads).toBe(2)));
			expect(saved).toEqual([{ allowNsfw: true }]);
			expect(view.interestEvents).toEqual(["acquire"]);
			expect(screen.getByRole("button", { name: "Save changes" }).hasAttribute("disabled")).toBe(
				true,
			);
		}),
	);

	it.live("submits a metadata language picked from the options", () =>
		Effect.gen(function* () {
			const saved: UpdateUserPreferencesBody[] = [];
			const view = mountPreferences(
				makeUserSettingsStub({
					updatePreferences: (_scope, request) =>
						Effect.sync(() => {
							saved.push(request.payload);
						}),
				}),
			);
			yield* Effect.promise(() => screen.findByRole("button", { name: "Save changes" }));

			fireEvent.click(screen.getByRole("button", { name: "Metadata language: Provider default" }));
			fireEvent.click(screen.getByRole("radio", { name: "Spanish" }));
			fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

			yield* Effect.promise(() => screen.findByText("Preferences saved."));
			expect(saved).toEqual([{ language: "es" }]);
			expect(view.interestEvents).toEqual(["acquire", "reconnect"]);
		}),
	);

	it.live("disables preference controls while a save is pending", () =>
		Effect.gen(function* () {
			const gate = Deferred.makeUnsafe<void>();
			mountPreferences(makeUserSettingsStub({ updatePreferences: () => Deferred.await(gate) }));
			yield* Effect.promise(() => screen.findByRole("button", { name: "Save changes" }));
			fireEvent.click(screen.getByRole("switch", { name: "Show NSFW content" }));
			fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

			const savingButton = yield* Effect.promise(() =>
				screen.findByRole("button", { name: "Saving..." }),
			);
			expect(savingButton.hasAttribute("disabled")).toBe(true);
			expect(
				screen.getByRole("switch", { name: "Show NSFW content" }).hasAttribute("disabled"),
			).toBe(true);
			expect(
				screen.getByRole("switch", { name: "Disable integrations" }).hasAttribute("disabled"),
			).toBe(true);
			expect(
				screen
					.getByRole("button", { name: "Metadata language: Provider default" })
					.hasAttribute("disabled"),
			).toBe(true);

			yield* Deferred.succeed(gate, undefined);
			yield* Effect.promise(() => screen.findByText("Preferences saved."));
		}),
	);

	it.live("does not reconnect when a metadata language save fails", () =>
		Effect.gen(function* () {
			const view = mountPreferences(
				makeUserSettingsStub({ updatePreferences: () => Effect.die("save failed") }),
			);
			yield* Effect.promise(() => screen.findByRole("button", { name: "Save changes" }));
			fireEvent.click(screen.getByRole("button", { name: "Metadata language: Provider default" }));
			fireEvent.click(screen.getByRole("radio", { name: "Spanish" }));
			fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
			yield* Effect.promise(() => screen.findByText("Could not save preferences. Try again."));
			expect(view.interestEvents).toEqual(["acquire"]);
		}),
	);

	it.live("keeps the edit available and explains a failed save", () =>
		Effect.gen(function* () {
			mountPreferences(
				makeUserSettingsStub({ updatePreferences: () => Effect.die("preference update failed") }),
			);
			yield* Effect.promise(() => screen.findByRole("button", { name: "Save changes" }));

			fireEvent.click(screen.getByRole("switch", { name: "Disable integrations" }));
			fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

			yield* Effect.promise(() => screen.findByText("Could not save preferences. Try again."));
			expect(
				screen.getByRole("switch", { name: "Disable integrations" }).getAttribute("aria-checked"),
			).toBe("true");
			expect(screen.getByRole("button", { name: "Save changes" }).hasAttribute("disabled")).toBe(
				false,
			);
		}),
	);

	it.live("keeps preferences visible when their mutation refresh fails", () =>
		Effect.gen(function* () {
			let settingsReads = 0;
			mountPreferences(
				makeUserSettingsStub({ updatePreferences: () => Effect.void }),
				undefined,
				makeUserSettingsQueries(() => {
					settingsReads++;
					if (settingsReads > 1) {
						throw new Error("settings refresh failed");
					}
					return userSettings;
				}),
			);
			const nsfw = yield* Effect.promise(() =>
				screen.findByRole("switch", { name: "Show NSFW content" }),
			);

			fireEvent.click(nsfw);
			fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

			yield* Effect.promise(() => screen.findByText("Preferences saved."));
			yield* Effect.promise(() => waitFor(() => expect(settingsReads).toBe(2)));
			expect(screen.getByRole("switch", { name: "Show NSFW content" })).toBe(nsfw);
			expect(
				screen.queryByText("Could not load your settings. Check the server and try again."),
			).toBeNull();
		}),
	);

	it.live("keeps appearance usable when the settings request fails", () =>
		Effect.gen(function* () {
			mountPreferences(
				makeUserSettingsStub(),
				AuthStub,
				makeUserSettingsQueries(() => {
					throw new Error("settings unavailable");
				}),
			);
			yield* Effect.promise(() => screen.findByRole("heading", { name: "Preferences" }));

			expect(screen.getByRole("radiogroup", { name: "Appearance" })).not.toBeNull();
			yield* Effect.promise(() =>
				screen.findByText("Could not load your settings. Check the server and try again."),
			);
		}),
	);
});

describe("pro instance badge", () => {
	it.live("crowns the sidebar account avatar when the server key is validated", () =>
		Effect.gen(function* () {
			mountView("/settings/preferences", undefined, undefined, undefined, makePublicApiStub(true));
			const sidebar = yield* Effect.promise(() => screen.findByTestId("desktop-sidebar"));

			expect(within(sidebar).getByRole("img", { name: "Ryot Pro" })).not.toBeNull();
		}),
	);

	it.live("leaves the sidebar account avatar plain when the server key is not validated", () =>
		Effect.gen(function* () {
			mountView("/settings/preferences");
			const sidebar = yield* Effect.promise(() => screen.findByTestId("desktop-sidebar"));

			expect(within(sidebar).queryByRole("img", { name: "Ryot Pro" })).toBeNull();
		}),
	);

	it.live("falls back to the community badge when the system config cannot be read", () =>
		Effect.gen(function* () {
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
			const sidebar = yield* Effect.promise(() => screen.findByTestId("desktop-sidebar"));

			expect(within(sidebar).queryByRole("img", { name: "Ryot Pro" })).toBeNull();
			expect(screen.getByRole("heading", { name: "Preferences" })).not.toBeNull();
		}),
	);
});

const mainContents = () => document.querySelectorAll("#main-content");

describe("document title and skip-link target", () => {
	it.live("titles a literal kernel route and gives the skip link a single target", () =>
		Effect.gen(function* () {
			mountView("/", null, []);
			yield* Effect.promise(() => screen.findByRole("heading", { name: "No workspaces enabled" }));

			yield* Effect.promise(() =>
				waitFor(() => expect(document.title).toBe("No workspaces — Ryot")),
			);
			expect(mainContents()).toHaveLength(1);
		}),
	);

	it.live("titles an AuthStatus branch from the shared frame", () =>
		Effect.gen(function* () {
			mountView("/auth", undefined, undefined, makeAuthStub({}, unauthenticated));
			yield* Effect.promise(() => screen.findByRole("heading", { name: "Opening sign-in" }));

			yield* Effect.promise(() =>
				waitFor(() => expect(document.title).toBe("Opening sign-in — Ryot")),
			);
			expect(mainContents()).toHaveLength(1);
		}),
	);

	it.live("retitles when navigating between routes", () =>
		Effect.gen(function* () {
			const view = mountView("/settings/preferences");
			yield* Effect.promise(() => screen.findByRole("heading", { name: "Preferences" }));
			yield* Effect.promise(() => waitFor(() => expect(document.title).toBe("Preferences — Ryot")));

			yield* Effect.promise(() => view.router.navigate({ href: "/settings/account" }));
			yield* Effect.promise(() => waitFor(() => expect(document.title).toBe("Account — Ryot")));
			expect(mainContents()).toHaveLength(1);
		}),
	);
});
