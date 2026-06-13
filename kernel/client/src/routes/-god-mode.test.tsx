import { Capacitor } from "@capacitor/core";
import { AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { AdminApi, AdminApiError, type AdminApiService } from "#/api/admin";
import { AuthenticatedApi } from "#/api/authenticated";
import { GodModeService } from "#/modules/god-mode/service";
import { GodModeSessionService, makeGodModeSessionService } from "#/modules/god-mode/session";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import { ArtifactSessions } from "#/modules/plugins/artifact-sessions";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/events.test-layer";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { PluginQueriesService } from "#/modules/plugins/queries";
import { ServerService } from "#/modules/server/service";
import { ClientStorage } from "#/persistence/storage";
import { getRouter } from "#/router";
import {
	OAuthRouteStubs,
	SavedViewRouteStubs,
	catalog,
	makeAuthStub,
	makePublicApiStub,
	makeStorageStub,
	server,
	theme,
} from "#/routes/-route-fixtures";

const makeView = (
	path = "/god-mode",
	selected: typeof server | null = server,
	adminService: AdminApiService = { run: () => Effect.die("not used") },
) => {
	const events = makePluginCatalogEventsTestLayer();
	const sessions = makeGodModeSessionService(() => "god-session");
	const admin = Layer.succeed(AdminApi, adminService);
	const session = Layer.succeed(GodModeSessionService, sessions);
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			makeAuthStub({ settledSession: () => Effect.die("OAuth guard must not run") }),
			SavedViewRouteStubs,
			makePublicApiStub(),
			AuthenticatedApi.layer,
			events.layer,
			admin,
			session,
			GodModeService.layer.pipe(Layer.provide(admin), Layer.provide(session)),
			Layer.succeed(ServerService, {
				connect: () => Effect.void,
				selected: Effect.succeed(selected),
			}),
			Layer.succeed(ArtifactSessions, {
				renew: () => Effect.die("not used"),
				revoke: () => Effect.die("not used"),
				create: () => Effect.die("not used"),
			}),
			Layer.succeed(PluginCatalogService, { load: () => Effect.succeed(catalog) }),
			Layer.succeed(PluginOperationsService, { invoke: () => Effect.die("not used") }),
			Layer.succeed(PluginQueriesService, { query: () => Effect.die("not used") }),
		).pipe(
			Layer.provideMerge(OAuthRouteStubs),
			Layer.provideMerge(Layer.succeed(ClientStorage, makeStorageStub())),
		),
	);
	const router = getRouter(
		{ runtime, theme, backInterceptors: createBackInterceptors() },
		createMemoryHistory({ initialEntries: [path] }),
	);
	const view = render(<RouterProvider router={router} />);
	return { ...view, router, runtime, sessions };
};

describe("God Mode route", () => {
	it("is outside the OAuth gate and redirects the index to users", async () => {
		const view = makeView();

		await screen.findByRole("heading", { name: "God Mode" });
		expect(view.router.state.location.pathname).toBe("/god-mode/users");
		expect(screen.queryByTestId("authenticated-shell")).toBeNull();
		expect(screen.queryByTestId("mobile-drawer")).toBeNull();
		expect(screen.queryByTitle("fixture plugin")).toBeNull();
	});

	it("redirects a native client without a selected server to onboarding with a return path", async () => {
		const native = Capacitor.isNativePlatform;
		Capacitor.isNativePlatform = () => true;
		try {
			const view = makeView("/god-mode/migration-report", null);
			await waitFor(() => expect(view.router.state.location.pathname).toBe("/onboarding"));
			expect(view.router.state.location.search.redirect).toBe("/god-mode/migration-report");
		} finally {
			Capacitor.isNativePlatform = native;
		}
	});

	it("requires a trimmed token, clears errors on edit, and submits with Enter", async () => {
		const user = userEvent.setup();
		const view = makeView("/god-mode/users");
		const token = await screen.findByLabelText("Admin access token");

		await user.type(token, "   ");
		const form = token.closest("form");
		if (form === null) {
			throw new Error("Token input must be inside a form");
		}
		fireEvent.submit(form);
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toBe("Enter an admin access token.");

		await user.type(token, " admin-token ");
		expect(screen.queryByRole("alert")).toBeNull();
		await user.type(token, "{Enter}");

		await screen.findByRole("heading", { name: "Users" });
		expect(await view.runtime.runPromise(view.sessions.get("god-session"))).toEqual({
			origin: server,
			token: "admin-token",
		});
	});

	it("locks, clears the memory session, and shows the token gate again", async () => {
		const user = userEvent.setup();
		const view = makeView("/god-mode/users");
		await user.type(await screen.findByLabelText("Admin access token"), "token{Enter}");
		await screen.findByRole("heading", { name: "Users" });

		await user.click(screen.getByRole("button", { name: "Lock" }));
		await screen.findByLabelText("Admin access token");
		expect(screen.queryByRole("alert")).toBeNull();
		await waitFor(async () =>
			expect(await view.runtime.runPromise(view.sessions.get("god-session"))).toBeNull(),
		);
	});

	it("relocks on an unauthorized request with an invalid-token message that editing clears", async () => {
		const user = userEvent.setup();
		const view = makeView("/god-mode/users", server, {
			run: () =>
				Effect.fail(
					new AdminApiError({
						cause: new AuthUnauthorized({ reason: { code: "admin-access-required" } }),
					}),
				),
		});

		await user.type(await screen.findByLabelText("Admin access token"), "token{Enter}");
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toBe("The admin access token is invalid or expired.");
		await waitFor(async () =>
			expect(await view.runtime.runPromise(view.sessions.get("god-session"))).toBeNull(),
		);

		await user.type(await screen.findByLabelText("Admin access token"), "replacement");
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("navigates between sections from the standalone shell", async () => {
		const user = userEvent.setup();
		const view = makeView("/god-mode/users");
		await user.type(await screen.findByLabelText("Admin access token"), "token{Enter}");
		const sidebar = await screen.findByTestId("god-mode-sidebar");

		await user.click(within(sidebar).getByRole("link", { name: "Migration report" }));
		await waitFor(() =>
			expect(view.router.state.location.pathname).toBe("/god-mode/migration-report"),
		);
		expect(screen.getByRole("heading", { name: "Migration report" })).toBeTruthy();
		expect(
			within(sidebar).getByRole("link", { name: "Migration report" }).getAttribute("aria-current"),
		).toBe("page");
	});
});
