import { describe, expect, it } from "@effect/vitest";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Effect, Layer, ManagedRuntime } from "effect";

import { KernelApiTestLayer } from "#/api/ports.test-layer";
import { PublicApi } from "#/api/public";
import type { HostedAuthService } from "#/modules/auth/hosted-service";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/events.test-layer";
import {
	makePluginCatalog,
	makePluginOperations,
	makePluginQueries,
	makePluginStorage,
} from "#/modules/plugins/services.test-layer";
import { getRouter } from "#/router";
import {
	theme,
	catalog,
	ServerStub,
	makeAuthStub,
	makeStorageStubLayer,
	GodModeRouteStubs,
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

const systemConfig = (frontendOrigin: string, localAuthDisabled = false) => ({
	analytics: {},
	frontendOrigin,
	version: "v1.0.0",
	pro: { isServerKeyValidated: false },
	notifications: { smtpEnabled: false },
	auth: { localAuthDisabled, oidcEnabled: true, signupAllowed: true },
	fileStorage: {
		temporaryUploadProvider: "local" as const,
		preferredPermanentUploadProvider: "local" as const,
	},
});

const mountTwoFactor = (
	path: string,
	hosted: Partial<HostedAuthService["Service"]> = {},
	config = systemConfig(window.location.origin),
) => {
	const calls: string[] = [];
	const oauth = makeOAuthRouteStubs(
		{},
		{
			signOutHosted: Effect.sync(() => {
				calls.push("sign-out");
			}),
			twoFactorSession: Effect.sync(() => {
				calls.push("session");
				return { twoFactorEnabled: false };
			}),
			submitCredentials: (input) =>
				Effect.sync(() => {
					calls.push(`sign-in:${input.mode}:${input.values.email}`);
					return { _tag: "Authenticated" } as const;
				}),
			...hosted,
		},
	);
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProviderAddRouteStubs,
			ImportsRouteStubs,
			IntegrationRouteStubs,
			NotificationChannelRouteStubs,
			makeAuthStub(),
			GodModeRouteStubs,
			ServerStub,
			SavedViewRouteStubs,
			EntityRouteStubs,
			Layer.succeed(PublicApi, {
				checkHealth: () => Effect.void,
				getSystemConfig: () => Effect.succeed(config),
			}),
			makePluginCatalog(catalog),
			NavigationRouteStubs,
			CustomizeRouteStubs,
			makePluginQueries(),
			makePluginStorage(),
			makePluginOperations(),
			makePluginCatalogEventsTestLayer().layer,
			KernelApiTestLayer,
			ClientPagesApiRouteStubs,
			ClientPageSessionsRouteStubs,
		).pipe(Layer.provideMerge(oauth), Layer.provideMerge(makeStorageStubLayer())),
	);
	const router = getRouter(
		{ theme, runtime, backInterceptors: createBackInterceptors() },
		createMemoryHistory({ initialEntries: [path] }),
	);
	render(<RouterProvider router={router} />);
	return { calls, router, user: userEvent.setup() };
};

const signIn = (user: ReturnType<typeof userEvent.setup>) =>
	Effect.gen(function* () {
		yield* Effect.promise(() =>
			user.type(screen.getByLabelText("Email address"), "user@ryot.example"),
		);
		yield* Effect.promise(() => user.type(screen.getByLabelText("Password"), "Sup3rSecret"));
		yield* Effect.promise(() => user.click(screen.getByRole("button", { name: "Sign in" })));
	});

describe("Hosted two-factor management", () => {
	it.live("refuses a mismatched frontend origin before sign-in", () =>
		Effect.gen(function* () {
			mountTwoFactor("/oauth/two-factor", {}, systemConfig("https://configured.example"));

			yield* Effect.promise(() => screen.findByText("Server configuration mismatch"));
			expect(screen.queryByLabelText("Password")).toBeNull();
		}),
	);

	it.live("explains that management needs password sign-in", () =>
		Effect.gen(function* () {
			mountTwoFactor("/oauth/two-factor", {}, systemConfig(window.location.origin, true));

			yield* Effect.promise(() => screen.findByText("Two-factor authentication unavailable"));
			expect(screen.queryByLabelText("Password")).toBeNull();
		}),
	);

	it.live("requires a fresh sign-in and reuses its password for setup", () =>
		Effect.gen(function* () {
			const enabled: string[] = [];
			const { user, calls } = mountTwoFactor("/oauth/two-factor", {
				enableTwoFactor: (password) =>
					Effect.sync(() => {
						enabled.push(password);
						return {
							backupCodes: [],
							secret: "JBSWY3DPEHPK3PXP",
							totpURI: "otpauth://totp/Ryot?secret=JBSWY3DPEHPK3PXP",
						};
					}),
			});

			yield* Effect.promise(() => screen.findByRole("heading", { name: "Welcome back" }));
			expect(screen.queryByRole("group", { name: "Authentication mode" })).toBeNull();
			yield* signIn(user);

			const setup = yield* Effect.promise(() =>
				screen.findByRole("button", { name: "Set up authenticator app" }),
			);
			expect(calls).toEqual(["sign-in:login:user@ryot.example", "session"]);
			expect(screen.queryByLabelText("Password")).toBeNull();
			yield* Effect.promise(() => user.click(setup));
			yield* Effect.promise(() => screen.findByLabelText("Authenticator code"));
			expect(enabled).toEqual(["Sup3rSecret"]);
		}),
	);

	it.live("completes the two-factor challenge before showing the enabled actions", () =>
		Effect.gen(function* () {
			const verified: string[] = [];
			const { user } = mountTwoFactor("/oauth/two-factor", {
				twoFactorSession: Effect.succeed({ twoFactorEnabled: true }),
				submitCredentials: () =>
					Effect.succeed({ _tag: "TwoFactor", methods: ["totp", "backupCode"] } as const),
				verifyTwoFactor: (method, code) =>
					Effect.sync(() => {
						verified.push(`${method}:${code}`);
					}),
			});

			yield* Effect.promise(() => screen.findByLabelText("Password"));
			yield* signIn(user);
			const code = yield* Effect.promise(() => screen.findByLabelText("Authenticator code"));
			yield* Effect.promise(() => user.type(code, "123456"));
			yield* Effect.promise(() => user.click(screen.getByRole("button", { name: "Verify" })));

			yield* Effect.promise(() =>
				screen.findByRole("button", { name: "Disable two-factor authentication" }),
			);
			expect(screen.getByRole("button", { name: "Regenerate backup codes" })).not.toBeNull();
			expect(verified).toEqual(["totp:123456"]);
		}),
	);

	it.live("signs out and returns to account settings when opened from settings", () =>
		Effect.gen(function* () {
			const { user, calls, router } = mountTwoFactor("/oauth/two-factor?from=settings");

			yield* Effect.promise(() => screen.findByLabelText("Password"));
			yield* signIn(user);
			const done = yield* Effect.promise(() => screen.findByRole("button", { name: "Done" }));
			yield* Effect.promise(() => user.click(done));

			yield* Effect.promise(() =>
				waitFor(() => expect(router.state.location.pathname).toBe("/settings/account")),
			);
			expect(calls.at(-1)).toBe("sign-out");
		}),
	);

	it.live("signs out and asks to close the window when opened directly", () =>
		Effect.gen(function* () {
			const { user, calls, router } = mountTwoFactor("/oauth/two-factor");

			yield* Effect.promise(() => screen.findByLabelText("Password"));
			yield* signIn(user);
			const done = yield* Effect.promise(() => screen.findByRole("button", { name: "Done" }));
			yield* Effect.promise(() => user.click(done));

			yield* Effect.promise(() =>
				screen.findByText("You can close this window and return to Ryot."),
			);
			expect(calls.at(-1)).toBe("sign-out");
			expect(router.state.location.pathname).toBe("/oauth/two-factor");
		}),
	);
});
