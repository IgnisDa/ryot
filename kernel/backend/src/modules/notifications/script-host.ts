import type { AutomationSandboxHostImplementationMap } from "@ryot-app/plugin-backend-sdk/core";
import { sandboxHostEffect, sandboxHostFailure } from "@ryot-app/sandbox/host/invocation";
import { Effect } from "effect";

import {
	requireSandboxCapabilityInput,
	type ScriptRunInput,
} from "#modules/scripts/authorization/capabilities";

import { NotificationsService } from "./service";

export const makeNotificationScriptHost = Effect.gen(function* () {
	const notifications = yield* NotificationsService;

	return {
		sendNotification: (rawInput, message) =>
			requireSandboxCapabilityInput(rawInput, "sendNotification").pipe(
				Effect.flatMap((input) => {
					if (input.hostCallDiscriminator === undefined) {
						return sandboxHostFailure("sendNotification requires a trusted durable host call");
					}
					const subject = input.principal.subject;
					if (
						subject.accountGeneration === null ||
						subject.executionUserId !== subject.accountGeneration.userId
					) {
						return sandboxHostFailure(
							"sendNotification requires trusted recipient account authority",
						);
					}
					return sandboxHostEffect(
						notifications
							.sendMessage({
								message: message.trim(),
								sourceRunId: subject.runId,
								accountGeneration: subject.accountGeneration,
								sourceKey: `${subject.runId}-host-${input.hostCallDiscriminator}-notification`,
							})
							.pipe(Effect.as(null)),
					);
				}),
			),
	} satisfies Pick<AutomationSandboxHostImplementationMap<ScriptRunInput>, "sendNotification">;
});
