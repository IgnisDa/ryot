import { UserId } from "@ryot-app/contract/schema/brands";
import { sandboxHostEffect } from "@ryot-app/sandbox/host/invocation";
import { Effect } from "effect";

import {
	type AdditionalScriptHostImplementationMap,
	requireSandboxCapabilityInput,
} from "#modules/scripts/authorization/capabilities";
import {
	sandboxLifecycleCommand,
	userSandboxRunUserId,
} from "#modules/scripts/host/execution-context";
import { userLifecycleSource } from "#modules/scripts/host/lifecycle-host";

import { UserCommands } from "./service";

export const makeUserCommandScriptHost = Effect.gen(function* () {
	const commands = yield* UserCommands;
	return {
		commitUserChanges: (rawInput, changes) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* requireSandboxCapabilityInput(rawInput, "commitUserChanges");
					const command = yield* sandboxLifecycleCommand(
						input,
						userLifecycleSource(input),
						"commitUserChanges",
					);
					return yield* commands.commit(changes, command, UserId.make(userSandboxRunUserId(input)));
				}),
			),
	} satisfies Pick<AdditionalScriptHostImplementationMap, "commitUserChanges">;
});
