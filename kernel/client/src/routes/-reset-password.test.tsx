import { Capacitor } from "@capacitor/core";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import type { ServerOrigin } from "#/api/origin";
import { KernelApiTestLayer } from "#/api/ports.test-layer";
import { HostedAuthError, type HostedAuthService } from "#/modules/auth/hosted-service";
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
	theme,
	server,
	catalog,
	makeAuthStub,
	makeStorageStub,
	GodModeRouteStubs,
	makePublicApiStub,
	CustomizeRouteStubs,
	SavedViewRouteStubs,
	makeOAuthRouteStubs,
	NavigationRouteStubs,
	ProviderAddRouteStubs,
} from "#/routes/-route-fixtures";

type ResetCall = {
	readonly token: string;
	readonly server: ServerOrigin;
	readonly password: string;
};

const makeView = (
	path = "/reset-password?token=reset-secret",
	selected: ServerOrigin | null = server,
	resetPassword: HostedAuthService["Service"]["resetPassword"] = () => Effect.void,
) => {
	const calls: ResetCall[] = [];
	const oauth = makeOAuthRouteStubs(
		{},
		{
			resetPassword: (origin, token, password) => {
				calls.push({ token, password, server: origin });
				return resetPassword(origin, token, password);
			},
		},
	);
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProviderAddRouteStubs,
			makeAuthStub({ settledSession: () => Effect.die("OAuth guard must not run") }),
			GodModeRouteStubs,
			SavedViewRouteStubs,
			makePublicApiStub(),
			KernelApiTestLayer,
			makePluginCatalogEventsTestLayer().layer,
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
			NavigationRouteStubs,
			CustomizeRouteStubs,
			Layer.succeed(PluginOperationsService, { invoke: () => Effect.die("not used") }),
			Layer.succeed(PluginQueriesService, { query: () => Effect.die("not used") }),
		).pipe(
			Layer.provideMerge(oauth),
			Layer.provideMerge(Layer.succeed(ClientStorage, makeStorageStub())),
		),
	);
	const router = getRouter(
		{ runtime, theme, backInterceptors: createBackInterceptors() },
		createMemoryHistory({ initialEntries: [path] }),
	);
	const view = render(<RouterProvider router={router} />);
	return { ...view, calls, router };
};

const fillPasswords = async (password: string, confirmation = password) => {
	const user = userEvent.setup();
	await user.type(await screen.findByLabelText("New password"), password);
	await user.type(screen.getByLabelText("Confirm password"), confirmation);
	return user;
};

describe("Reset password route", () => {
	it("is public and renders the reset form instead of starting OAuth", async () => {
		const view = makeView();

		await screen.findByRole("heading", { name: "Choose a new password" });
		expect(view.router.state.location.pathname).toBe("/reset-password");
		expect(screen.queryByText("Opening sign-in")).toBeNull();
	});

	it("shows an invalid-link state when the token is missing", async () => {
		makeView("/reset-password");

		await screen.findByRole("heading", { name: "Invalid reset link" });
		expect(screen.getByText(/missing its token/)).not.toBeNull();
	});

	it("validates password length and confirmation before calling the service", async () => {
		const view = makeView();
		const user = await fillPasswords("short");

		await user.click(screen.getByRole("button", { name: "Update password" }));
		expect(await screen.findByText("Password must be at least 8 characters.")).not.toBeNull();
		expect(view.calls).toEqual([]);

		await user.clear(screen.getByPlaceholderText("New password"));
		await user.clear(screen.getByPlaceholderText("Confirm password"));
		await user.type(screen.getByPlaceholderText("New password"), "new-password");
		await user.type(screen.getByPlaceholderText("Confirm password"), "different-password");
		await user.click(screen.getByRole("button", { name: "Update password" }));
		expect(await screen.findByText("Passwords do not match.")).not.toBeNull();
		expect(view.calls).toEqual([]);
	});

	it("submits the selected server, token, and password and links back to auth", async () => {
		const view = makeView();
		const user = await fillPasswords("new-password");

		await user.click(screen.getByRole("button", { name: "Update password" }));
		await screen.findByRole("heading", { name: "Password updated" });
		expect(view.calls).toEqual([{ token: "reset-secret", password: "new-password", server }]);

		await user.click(screen.getByRole("button", { name: "Sign in" }));
		await waitFor(() => expect(view.router.state.location.pathname).toBe("/auth"));
	});

	it("shows stable copy for an invalid or expired token", async () => {
		makeView("/reset-password?token=expired", server, () =>
			Effect.fail(new HostedAuthError({ code: "INVALID_TOKEN", message: "internal detail" })),
		);
		const user = await fillPasswords("new-password");

		await user.click(screen.getByRole("button", { name: "Update password" }));
		expect(
			await screen.findByText("This password reset link is invalid or has expired."),
		).not.toBeNull();
		expect(screen.queryByText("internal detail")).toBeNull();
	});

	it("redirects a native client without a server through onboarding", async () => {
		const native = Capacitor.isNativePlatform;
		Capacitor.isNativePlatform = () => true;
		try {
			const view = makeView("/reset-password?token=reset%20secret", null);
			await waitFor(() => expect(view.router.state.location.pathname).toBe("/onboarding"));
			expect(view.router.state.location.search.redirect).toBe(
				"/reset-password?token=reset%20secret",
			);
		} finally {
			Capacitor.isNativePlatform = native;
		}
	});
});
