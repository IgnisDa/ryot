import { Capacitor } from "@capacitor/core";
import { describe, expect, it } from "@effect/vitest";
import { AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Effect, Layer, ManagedRuntime } from "effect";

import { AdminApi, AdminApiError, type AdminApiService } from "#/api/admin";
import { GodModeApi } from "#/api/god-mode";
import { KernelApiTestLayer } from "#/api/ports.test-layer";
import { GodModeImpersonationService } from "#/modules/god-mode/impersonation";
import { GodModeService } from "#/modules/god-mode/service";
import { GodModeSessionService, makeGodModeSessionService } from "#/modules/god-mode/session";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/events.test-layer";
import {
	makePluginCatalog,
	makePluginOperations,
	makePluginQueries,
	makePluginStorage,
} from "#/modules/plugins/services.test-layer";
import { ServerService } from "#/modules/server/service";
import { getRouter } from "#/router";
import {
	theme,
	server,
	catalog,
	makeAuthStub,
	OAuthRouteStubs,
	makeStorageStubLayer,
	makePublicApiStub,
	CustomizeRouteStubs,
	SavedViewRouteStubs,
	EntityRouteStubs,
	NavigationRouteStubs,
	ProviderAddRouteStubs,
	ImportsRouteStubs,
	IntegrationRouteStubs,
	ClientPagesApiRouteStubs,
	ClientPageSessionsRouteStubs,
	NotificationChannelRouteStubs,
} from "#/routes/-route-fixtures";

const makeView = (
	path = "/god-mode",
	selected: typeof server | null = server,
	adminService: AdminApiService = {
		run: () => Effect.die("not used"),
		download: () => Effect.die("not used"),
	},
) => {
	const events = makePluginCatalogEventsTestLayer();
	const sessions = makeGodModeSessionService(() => "god-session");
	const godMode = GodModeApi.layer.pipe(Layer.provide(Layer.succeed(AdminApi, adminService)));
	const session = Layer.succeed(GodModeSessionService, sessions);
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProviderAddRouteStubs,
			ImportsRouteStubs,
			IntegrationRouteStubs,
			NotificationChannelRouteStubs,
			NotificationChannelRouteStubs,
			makeAuthStub({ settledSession: () => Effect.die("OAuth guard must not run") }),
			SavedViewRouteStubs,
			EntityRouteStubs,
			makePublicApiStub(),
			KernelApiTestLayer,
			ClientPagesApiRouteStubs,
			ClientPageSessionsRouteStubs,
			events.layer,
			godMode,
			session,
			Layer.succeed(GodModeImpersonationService, { start: () => Effect.void }),
			GodModeService.layer.pipe(Layer.provide(godMode), Layer.provide(session)),
			Layer.succeed(ServerService, {
				connect: () => Effect.void,
				selected: Effect.succeed(selected),
			}),
			makePluginCatalog(catalog),
			NavigationRouteStubs,
			CustomizeRouteStubs,
			makePluginOperations(),
			makePluginQueries(),
			makePluginStorage(),
		).pipe(Layer.provideMerge(OAuthRouteStubs), Layer.provideMerge(makeStorageStubLayer())),
	);
	const router = getRouter(
		{ theme, runtime, backInterceptors: createBackInterceptors() },
		createMemoryHistory({ initialEntries: [path] }),
	);
	const view = render(<RouterProvider router={router} />);
	return { ...view, router, runtime, sessions };
};

describe("God Mode route", () => {
	it.live("is outside the OAuth gate and redirects the index to users", () =>
		Effect.gen(function* () {
			const view = makeView();

			yield* Effect.promise(() => screen.findByRole("heading", { name: "God Mode" }));
			expect(view.router.state.location.pathname).toBe("/god-mode/users");
			expect(screen.queryByTestId("authenticated-shell")).toBeNull();
			expect(screen.queryByTestId("mobile-drawer")).toBeNull();
			expect(screen.queryByTitle("fixture plugin")).toBeNull();
		}),
	);

	it.live(
		"redirects a native client without a selected server to onboarding with a return path",
		() => {
			const native = Capacitor.isNativePlatform;
			Capacitor.isNativePlatform = () => true;
			return Effect.gen(function* () {
				const view = makeView("/god-mode/migration-report", null);
				yield* Effect.promise(() =>
					waitFor(() => expect(view.router.state.location.pathname).toBe("/onboarding")),
				);
				expect(view.router.state.location.search.redirect).toBe("/god-mode/migration-report");
			}).pipe(Effect.ensuring(Effect.sync(() => (Capacitor.isNativePlatform = native))));
		},
	);

	it.live("requires a trimmed token, clears errors on edit, and submits with Enter", () =>
		Effect.gen(function* () {
			const user = userEvent.setup();
			const view = makeView("/god-mode/users");
			const token = yield* Effect.promise(() => screen.findByLabelText("Admin access token"));

			yield* Effect.promise(() => user.type(token, "   "));
			const form = token.closest("form");
			if (form === null) {
				throw new Error("Token input must be inside a form");
			}
			fireEvent.submit(form);
			const alert = yield* Effect.promise(() => screen.findByRole("alert"));
			expect(alert.textContent).toBe("Enter an admin access token.");

			yield* Effect.promise(() => user.type(token, " admin-token "));
			expect(screen.queryByRole("alert")).toBeNull();
			yield* Effect.promise(() => user.type(token, "{Enter}"));

			yield* Effect.promise(() => screen.findByRole("heading", { name: "Users" }));
			expect(
				yield* Effect.promise(() => view.runtime.runPromise(view.sessions.get("god-session"))),
			).toEqual({ origin: server, token: "admin-token" });
		}),
	);

	it.live("locks, clears the memory session, and shows the token gate again", () =>
		Effect.gen(function* () {
			const user = userEvent.setup();
			const view = makeView("/god-mode/users");
			const token = yield* Effect.promise(() => screen.findByLabelText("Admin access token"));
			yield* Effect.promise(() => user.type(token, "token{Enter}"));
			yield* Effect.promise(() => screen.findByRole("heading", { name: "Users" }));

			yield* Effect.promise(() => user.click(screen.getByRole("button", { name: "Lock" })));
			yield* Effect.promise(() => screen.findByLabelText("Admin access token"));
			expect(screen.queryByRole("alert")).toBeNull();
			yield* Effect.promise(() =>
				waitFor(() =>
					view.runtime.runPromise(
						view.sessions
							.get("god-session")
							.pipe(Effect.map((session) => expect(session).toBeNull())),
					),
				),
			);
		}),
	);

	it.live(
		"relocks on an unauthorized request with an invalid-token message that editing clears",
		() =>
			Effect.gen(function* () {
				const user = userEvent.setup();
				const view = makeView("/god-mode/users", server, {
					download: () => Effect.die("not used"),
					run: () =>
						Effect.fail(
							new AdminApiError({
								cause: new AuthUnauthorized({ reason: { code: "admin-access-required" } }),
							}),
						),
				});

				const token = yield* Effect.promise(() => screen.findByLabelText("Admin access token"));
				yield* Effect.promise(() => user.type(token, "token{Enter}"));
				const alert = yield* Effect.promise(() => screen.findByRole("alert"));
				expect(alert.textContent).toBe("The admin access token is invalid or expired.");
				yield* Effect.promise(() =>
					waitFor(() =>
						view.runtime.runPromise(
							view.sessions
								.get("god-session")
								.pipe(Effect.map((session) => expect(session).toBeNull())),
						),
					),
				);

				yield* Effect.promise(() =>
					user.type(screen.getByLabelText("Admin access token"), "replacement"),
				);
				expect(screen.queryByRole("alert")).toBeNull();
			}),
	);

	it.live("navigates between sections from the standalone shell", () =>
		Effect.gen(function* () {
			const user = userEvent.setup();
			const view = makeView("/god-mode/users");
			const token = yield* Effect.promise(() => screen.findByLabelText("Admin access token"));
			yield* Effect.promise(() => user.type(token, "token{Enter}"));
			const sidebar = yield* Effect.promise(() => screen.findByTestId("god-mode-sidebar"));

			yield* Effect.promise(() =>
				user.click(within(sidebar).getByRole("link", { name: "Migration report" })),
			);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(view.router.state.location.pathname).toBe("/god-mode/migration-report"),
				),
			);
			expect(screen.getByRole("heading", { name: "Migration report" })).toBeTruthy();
			expect(
				within(sidebar)
					.getByRole("link", { name: "Migration report" })
					.getAttribute("aria-current"),
			).toBe("page");
		}),
	);
});
