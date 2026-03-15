import { EntityId, UserId } from "@ryot/contract/schema/brands";
import type { AutomationSandboxHostImplementationMap } from "@ryot/sandbox-sdk/core";
import { DateTime, Effect, Option } from "effect";

import {
	requireSandboxCapabilityInput,
	sandboxHostEffect,
	sandboxHostFailure,
	type SandboxRunInput,
} from "#lib/infrastructure/sandbox-runtime/shared";
import { NotificationsService } from "#modules/notifications/service";
import { SignalEmissionService } from "#modules/signals/service";

export const makeAutomationSandboxApiFunctions: Effect.Effect<
	AutomationSandboxHostImplementationMap<SandboxRunInput>,
	never,
	NotificationsService | SignalEmissionService
> = Effect.gen(function* () {
	const signals = yield* SignalEmissionService;
	const notifications = yield* NotificationsService;

	return {
		emitSignal: (rawInput, request) =>
			requireSandboxCapabilityInput(rawInput, "emitSignal").pipe(
				Effect.flatMap((input) => {
					const execution = input.authority.subscriptionRun;
					const occurredAt = DateTime.make(execution.occurredAt);
					if (Option.isNone(occurredAt)) {
						return sandboxHostFailure("emitSignal received an invalid occurrence time");
					}

					return sandboxHostEffect(
						signals
							.emit({
								origin: execution.origin,
								executionId: execution.id,
								properties: request.properties,
								schemaSlug: request.schemaSlug,
								discriminator: request.discriminator,
								occurredAt: DateTime.toDate(occurredAt.value),
								principal: { kind: "user", userId: UserId.make(input.authority.userId) },
								...(request.subjectEntityId
									? { subjectEntityId: EntityId.make(request.subjectEntityId) }
									: {}),
							})
							.pipe(
								Effect.map((result) => ({
									signalId: result.signal.id,
									wasCreated: result.wasCreated,
								})),
							),
					);
				}),
			),
		sendNotification: (rawInput, message) =>
			requireSandboxCapabilityInput(rawInput, "sendNotification").pipe(
				Effect.flatMap((input) =>
					sandboxHostEffect(
						notifications
							.sendMessage({
								message: message.trim(),
								userId: UserId.make(input.authority.userId),
								executionId: `${input.authority.subscriptionRun.id}-notification`,
							})
							.pipe(Effect.as(null)),
					),
				),
			),
	} satisfies AutomationSandboxHostImplementationMap<SandboxRunInput>;
});
