import { UserId } from "@ryot-app/contract/schema/brands";
import { sandboxHostEffect } from "@ryot-app/sandbox/host/invocation";
import { Effect } from "effect";

import {
	requireSandboxCapabilityInput,
	type AdditionalScriptHostImplementationMap,
} from "#modules/scripts/authorization/capabilities";
import {
	sandboxLifecycleCommand,
	userSandboxRunUserId,
} from "#modules/scripts/host/execution-context";
import { userLifecycleSource } from "#modules/scripts/host/lifecycle-host";
import { SandboxSubmissionCommands } from "#modules/scripts/host/submission-command";

import { UserCommands } from "./service";

export const makeUserCommandScriptHost = Effect.gen(function* () {
	const commands = yield* UserCommands;
	const submissions = yield* SandboxSubmissionCommands;
	return {
		commitUserChanges: (rawInput, changes, options) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* requireSandboxCapabilityInput(rawInput, "commitUserChanges");
					const command = yield* submissions.commandFor(
						input,
						yield* sandboxLifecycleCommand(input, userLifecycleSource(input), "commitUserChanges"),
						options,
					);
					return yield* commands.commit(changes, command, UserId.make(userSandboxRunUserId(input)));
				}),
			),
	} satisfies Pick<AdditionalScriptHostImplementationMap, "commitUserChanges">;
});
