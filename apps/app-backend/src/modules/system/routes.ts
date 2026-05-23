import { HttpApiBuilder } from "@effect/platform";
import { Effect, Option } from "effect";

import { AppContract } from "../../contract";
import { AppConfig, isOidcEnabled } from "../../lib/config";

export const SystemRoutesLive = HttpApiBuilder.group(AppContract, "system", (handlers) =>
	handlers
		.handle("health", () => Effect.succeed({ status: "healthy" as const }))
		.handle("config", () =>
			Effect.gen(function* () {
				const config = yield* AppConfig;
				return {
					auth: {
						oidcEnabled: isOidcEnabled(config),
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
