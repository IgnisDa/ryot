import { UserId } from "@ryot-app/contract/schema/brands";
import type { AutomationSandboxHostImplementationMap } from "@ryot-app/plugin-backend-sdk/core";
import {
	requireSandboxCapabilityInput,
	sandboxHostEffect,
	sandboxHostFailure,
	type SandboxRunInput,
} from "@ryot-app/sandbox/host/invocation";
import { Effect } from "effect";

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
					return sandboxHostEffect(
						notifications
							.sendMessage({
								message: message.trim(),
								userId: UserId.make(input.principal.subject.executionUserId),
								executionId: `${input.principal.subject.runId}-host-${input.hostCallDiscriminator}-notification`,
							})
							.pipe(Effect.as(null)),
					);
				}),
			),
	} satisfies Pick<AutomationSandboxHostImplementationMap<SandboxRunInput>, "sendNotification">;
});
