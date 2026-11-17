import type { AutomationSandboxHostImplementationMap } from "@ryot-app/plugin-backend-sdk/core";
import { sandboxHostEffect, sandboxHostFailure } from "@ryot-app/sandbox/host/invocation";
import { Effect, Result } from "effect";

import {
	requireSandboxCapabilityInput,
	type ScriptRunInput,
} from "#modules/scripts/authorization/capabilities";
import { runNotification } from "#modules/scripts/authorization/principal";

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
					const admission = runNotification(input.principal, input.hostCallDiscriminator, message);
					if (Result.isFailure(admission)) {
						return sandboxHostFailure(admission.failure);
					}
					return sandboxHostEffect(
						notifications.sendMessage(admission.success).pipe(Effect.as(null)),
					);
				}),
			),
	} satisfies Pick<AutomationSandboxHostImplementationMap<ScriptRunInput>, "sendNotification">;
});
