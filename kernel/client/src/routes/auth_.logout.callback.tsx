import { Browser } from "@capacitor/browser";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Effect } from "effect";

import { normalizeServerOrigin } from "#/api/origin";
import { OAuthTokenService } from "#/modules/auth/token-service";
import { isNativePlatform } from "#/modules/navigation/native-navigation";
import { ServerService } from "#/modules/server/service";

export const Route = createFileRoute("/auth_/logout/callback")({
	beforeLoad: async ({ context }) => {
		await context.runtime.runPromise(
			Effect.gen(function* () {
				const isNative = isNativePlatform();
				const selected = isNative
					? yield* Effect.flatMap(ServerService, (service) => service.selected)
					: window.location.origin;
				if (isNative) {
					yield* Effect.tryPromise(() => Browser.close()).pipe(Effect.catch(() => Effect.void));
				}
				if (selected) {
					yield* Effect.flatMap(OAuthTokenService, (tokens) =>
						tokens.clear(normalizeServerOrigin(selected)),
					);
				}
			}),
		);
		// oxlint-disable-next-line typescript/only-throw-error
		throw redirect({ replace: true, to: "/auth", search: { redirect: undefined } });
	},
});
