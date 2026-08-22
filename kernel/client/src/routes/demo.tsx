import {
	getWebOAuthCallbackUri,
	getWebOAuthLogoutCallbackUri,
	OAUTH_DEMO_WEB_CLIENT_ID,
	OAUTH_WEB_CLIENT_ID,
} from "@ryot-app/contract/oauth";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useEffectEvent, useRef } from "react";

import { decodeServerOrigin } from "#/api/origin";
import { HostedAuthService } from "#/modules/auth/hosted-service";
import { OAuthLauncher } from "#/modules/auth/oauth-launcher";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { AuthService } from "#/modules/auth/service";
import { AuthStatus } from "#/modules/auth/status";

export const Route = createFileRoute("/demo")({
	component: DemoLaunch,
	errorComponent: DemoUnavailable,
	pendingComponent: () => (
		<AuthStatus title="Opening demo" message="Preparing the shared demo account..." />
	),
	beforeLoad: async ({ context }) => {
		const result = await context.runtime.runPromise(
			Effect.gen(function* () {
				const runtimeClient = yield* RuntimeOAuthClientService;
				if (runtimeClient.isNative) {
					return { _tag: "Native" } as const;
				}
				const serverOrigin = decodeServerOrigin(window.location.origin);
				const auth = yield* AuthService;
				const session = yield* auth.settledSession(serverOrigin);
				if (session.status === "authenticated") {
					return { _tag: "Authenticated" } as const;
				}
				const hosted = yield* HostedAuthService;
				const { mode } = yield* hosted.signInDemo();
				const launcher = yield* OAuthLauncher;
				return yield* launcher.prepare(undefined, {
					serverOrigin,
					client: {
						nativeApplicationId: null,
						callbackUri: getWebOAuthCallbackUri(serverOrigin),
						logoutUri: getWebOAuthLogoutCallbackUri(serverOrigin),
						clientId: mode === "demo" ? OAUTH_DEMO_WEB_CLIENT_ID : OAUTH_WEB_CLIENT_ID,
					},
				});
			}),
		);
		if (result._tag === "Native") {
			// oxlint-disable-next-line typescript/only-throw-error
			throw redirect({ to: "/auth", replace: true, search: { redirect: undefined } });
		}
		if (result._tag === "Authenticated") {
			// oxlint-disable-next-line typescript/only-throw-error
			throw redirect({ to: "/", replace: true });
		}
		if (result._tag === "MissingServer") {
			throw new Error("The browser origin is unavailable.");
		}
		return { plan: result.plan };
	},
});

function DemoUnavailable() {
	return (
		<AuthStatus
			title="Demo unavailable"
			message="The shared demo account is not available on this server."
		/>
	);
}

function DemoLaunch() {
	const { plan, runtime } = Route.useRouteContext();
	const launcher = runtime.runSync(OAuthLauncher);
	const launched = useRef(false);
	const launch = useEffectEvent(() => {
		void runtime.runPromise(launcher.launch(plan));
	});

	useEffect(() => {
		if (!launched.current) {
			launched.current = true;
			launch();
		}
	}, []);

	return <AuthStatus title="Opening demo" message="Continuing to the shared demo account..." />;
}
