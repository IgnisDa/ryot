import { HttpApiBuilder } from "@effect/platform";
import { Effect, Option, Redacted } from "effect";

import { AppContract } from "../../contract";
import { AppConfig } from "../../lib/config";

export const SystemRoutesLive = HttpApiBuilder.group(AppContract, "system", (handlers) =>
	handlers
		.handle("health", () => Effect.succeed({ status: "healthy" as const }))
		.handle("config", () =>
			Effect.gen(function* () {
				const config = yield* AppConfig;
				const { clientId, clientSecret, issuerUrl } = config.server.oidc;
				const oidcEnabled =
					Option.isSome(clientId) &&
					clientId.value.length > 0 &&
					Option.isSome(issuerUrl) &&
					issuerUrl.value.length > 0 &&
					Option.isSome(clientSecret) &&
					Redacted.value(clientSecret.value).length > 0;
				return {
					auth: {
						oidcEnabled,
						localAuthDisabled: config.users.disableLocalAuth,
						signupAllowed: config.users.allowRegistration && !config.users.disableLocalAuth,
						oidcButtonLabel: Option.getOrUndefined(
							Option.filter(config.frontend.oidcButtonLabel, (label) => label.length > 0),
						),
					},
				};
			}),
		),
);
