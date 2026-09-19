import { Capacitor } from "@capacitor/core";
import { describe, expect, it } from "@effect/vitest";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Effect, Layer, ManagedRuntime } from "effect";

import type { ServerOrigin } from "#/api/origin";
import { KernelApiTestLayer } from "#/api/ports.test-layer";
import { HostedAuthError, type HostedAuthService } from "#/modules/auth/hosted-service";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/events.test-layer";
import {
	makePluginCatalog,
	makePluginOperations,
	makePluginQueries,
} from "#/modules/plugins/services.test-layer";
import { ServerService } from "#/modules/server/service";
import { getRouter } from "#/router";
import {
	theme,
	server,
	catalog,
	makeAuthStub,
	makeStorageStubLayer,
	GodModeRouteStubs,
	makePublicApiStub,
	CustomizeRouteStubs,
	SavedViewRouteStubs,
	EntityRouteStubs,
	makeOAuthRouteStubs,
	NavigationRouteStubs,
	ProviderAddRouteStubs,
	ImportsRouteStubs,
	IntegrationRouteStubs,
	ClientPagesApiRouteStubs,
	ClientPageSessionsRouteStubs,
	NotificationChannelRouteStubs,
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
			ImportsRouteStubs,
			IntegrationRouteStubs,
			NotificationChannelRouteStubs,
			NotificationChannelRouteStubs,
			makeAuthStub({ settledSession: () => Effect.die("OAuth guard must not run") }),
			GodModeRouteStubs,
			SavedViewRouteStubs,
			EntityRouteStubs,
			makePublicApiStub(),
			KernelApiTestLayer,
			ClientPagesApiRouteStubs,
			ClientPageSessionsRouteStubs,
			makePluginCatalogEventsTestLayer().layer,
			Layer.succeed(ServerService, {
				connect: () => Effect.void,
				selected: Effect.succeed(selected),
			}),
			makePluginCatalog(catalog),
			NavigationRouteStubs,
			CustomizeRouteStubs,
			makePluginOperations(),
			makePluginQueries(),
		).pipe(Layer.provideMerge(oauth), Layer.provideMerge(makeStorageStubLayer())),
	);
	const router = getRouter(
		{ theme, runtime, backInterceptors: createBackInterceptors() },
		createMemoryHistory({ initialEntries: [path] }),
	);
	const view = render(<RouterProvider router={router} />);
	return { ...view, calls, router };
};

const fillPasswords = (password: string, confirmation = password) => {
	const user = userEvent.setup();
	return Effect.runPromise(
		Effect.gen(function* () {
			const input = yield* Effect.promise(() => screen.findByLabelText("New password"));
			yield* Effect.promise(() => user.type(input, password));
			yield* Effect.promise(() =>
				user.type(screen.getByLabelText("Confirm password"), confirmation),
			);
			return user;
		}),
	);
};

describe("Reset password route", () => {
	it.live("is public and renders the reset form instead of starting OAuth", () =>
		Effect.gen(function* () {
			const view = makeView();

			yield* Effect.promise(() => screen.findByRole("heading", { name: "Choose a new password" }));
			expect(view.router.state.location.pathname).toBe("/reset-password");
			expect(screen.queryByText("Opening sign-in")).toBeNull();
		}),
	);

	it.live("shows an invalid-link state when the token is missing", () =>
		Effect.gen(function* () {
			makeView("/reset-password");

			yield* Effect.promise(() => screen.findByRole("heading", { name: "Invalid reset link" }));
			expect(screen.getByText(/missing its token/)).not.toBeNull();
		}),
	);

	it.live("validates password length and confirmation before calling the service", () =>
		Effect.gen(function* () {
			const view = makeView();
			const user = yield* Effect.promise(() => fillPasswords("short"));

			yield* Effect.promise(() =>
				user.click(screen.getByRole("button", { name: "Update password" })),
			);
			expect(
				yield* Effect.promise(() => screen.findByText("Password must be at least 8 characters.")),
			).not.toBeNull();
			expect(view.calls).toEqual([]);

			yield* Effect.promise(() => user.clear(screen.getByPlaceholderText("New password")));
			yield* Effect.promise(() => user.clear(screen.getByPlaceholderText("Confirm password")));
			yield* Effect.promise(() =>
				user.type(screen.getByPlaceholderText("New password"), "new-password"),
			);
			yield* Effect.promise(() =>
				user.type(screen.getByPlaceholderText("Confirm password"), "different-password"),
			);
			yield* Effect.promise(() =>
				user.click(screen.getByRole("button", { name: "Update password" })),
			);
			expect(
				yield* Effect.promise(() => screen.findByText("Passwords do not match.")),
			).not.toBeNull();
			expect(view.calls).toEqual([]);
		}),
	);

	it.live("submits the selected server, token, and password and links back to auth", () =>
		Effect.gen(function* () {
			const view = makeView();
			const user = yield* Effect.promise(() => fillPasswords("new-password"));

			yield* Effect.promise(() =>
				user.click(screen.getByRole("button", { name: "Update password" })),
			);
			yield* Effect.promise(() => screen.findByRole("heading", { name: "Password updated" }));
			expect(view.calls).toEqual([{ server, token: "reset-secret", password: "new-password" }]);

			yield* Effect.promise(() => user.click(screen.getByRole("button", { name: "Sign in" })));
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.pathname).toBe("/auth")),
			);
		}),
	);

	it.live("shows stable copy for an invalid or expired token", () =>
		Effect.gen(function* () {
			makeView("/reset-password?token=expired", server, () =>
				Effect.fail(new HostedAuthError({ code: "INVALID_TOKEN", message: "internal detail" })),
			);
			const user = yield* Effect.promise(() => fillPasswords("new-password"));

			yield* Effect.promise(() =>
				user.click(screen.getByRole("button", { name: "Update password" })),
			);
			expect(
				yield* Effect.promise(() =>
					screen.findByText("This password reset link is invalid or has expired."),
				),
			).not.toBeNull();
			expect(screen.queryByText("internal detail")).toBeNull();
		}),
	);

	it.live("redirects a native client without a server through onboarding", () => {
		const native = Capacitor.isNativePlatform;
		Capacitor.isNativePlatform = () => true;
		return Effect.gen(function* () {
			const view = makeView("/reset-password?token=reset%20secret", null);
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.pathname).toBe("/onboarding")),
			);
			expect(view.router.state.location.search.redirect).toBe(
				"/reset-password?token=reset%20secret",
			);
		}).pipe(Effect.ensuring(Effect.sync(() => (Capacitor.isNativePlatform = native))));
	});
});
