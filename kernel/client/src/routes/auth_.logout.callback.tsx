import { Browser } from "@capacitor/browser";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Effect } from "effect";

import { decodeServerOrigin } from "#/api/origin";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { OAuthTokenService } from "#/modules/auth/token-service";
import { ServerService } from "#/modules/server/service";

export const Route = createFileRoute("/auth_/logout/callback")({
	validateSearch: (search) => ({
		state: typeof search.state === "string" ? search.state : undefined,
	}),
	beforeLoad: ({ search, context }) =>
		context.runtime.runPromise(
			Effect.gen(function* () {
				const runtimeClient = yield* RuntimeOAuthClientService;
				const selected = runtimeClient.isNative
					? yield* Effect.flatMap(ServerService, (service) => service.selected)
					: decodeServerOrigin(window.location.origin);
				if (runtimeClient.isNative) {
					yield* Effect.tryPromise(() => Browser.close()).pipe(Effect.ignore);
				}
				if (selected) {
					yield* Effect.flatMap(OAuthTokenService, (tokens) => tokens.clear(selected));
				}
				if (search.state === "impersonation") {
					yield* Effect.sync(() => window.location.replace("/god-mode/users"));
					return;
				}
				// oxlint-disable-next-line typescript/only-throw-error
				throw redirect({ to: "/auth", replace: true, search: { redirect: undefined } });
			}),
		),
});
