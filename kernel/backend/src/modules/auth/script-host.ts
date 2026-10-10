import { UserId } from "@ryot-app/contract/schema/brands";
import {
	requireSandboxCapabilityInput,
	sandboxHostEffect,
	type AdditionalSandboxHostImplementationMap,
} from "@ryot-app/sandbox/host/invocation";
import { Effect } from "effect";

import { userSandboxRunUserId } from "#modules/scripts/host/execution-context";

import { AuthRepository } from "./repository";

export const makeAuthScriptHost = Effect.gen(function* () {
	const auth = yield* AuthRepository;
	const readUserPreferences = (userId: UserId) =>
		Effect.gen(function* () {
			const preferences = yield* auth
				.getUserPreferences(userId)
				.pipe(
					Effect.mapError((error) =>
						error.message.startsWith("Invalid stored user preferences:")
							? "Invalid stored user preferences"
							: error,
					),
				);
			if (!preferences) {
				return yield* Effect.fail("User not found");
			}
			return { disableIntegrations: preferences.disableIntegrations };
		});

	return {
		getUserPreferences: (rawInput) =>
			requireSandboxCapabilityInput(rawInput, "getUserPreferences").pipe(
				Effect.flatMap((input) => readUserPreferences(UserId.make(userSandboxRunUserId(input)))),
				sandboxHostEffect,
			),
	} satisfies Pick<AdditionalSandboxHostImplementationMap, "getUserPreferences">;
});
