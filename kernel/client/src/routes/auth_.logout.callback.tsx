import { Browser } from "@capacitor/browser";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Effect } from "effect";

import { decodeServerOrigin } from "#/api/origin";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { OAuthTokenService } from "#/modules/auth/token-service";
import { ServerService } from "#/modules/server/service";

export const Route = createFileRoute("/auth_/logout/callback")({
	beforeLoad: async ({ context }) => {
		await context.runtime.runPromise(
			Effect.gen(function* () {
				const runtimeClient = yield* RuntimeOAuthClientService;
				const selected = runtimeClient.isNative
					? yield* Effect.flatMap(ServerService, (service) => service.selected)
					: decodeServerOrigin(window.location.origin);
				if (runtimeClient.isNative) {
					yield* Effect.tryPromise(() => Browser.close()).pipe(Effect.catch(() => Effect.void));
				}
				if (selected) {
					yield* Effect.flatMap(OAuthTokenService, (tokens) => tokens.clear(selected));
				}
			}),
		);
		// oxlint-disable-next-line typescript/only-throw-error
		throw redirect({ replace: true, to: "/auth", search: { redirect: undefined } });
	},
});
