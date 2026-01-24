import { EntityId, UserId } from "@ryot/contract/schema/brands";
import type { AutomationSandboxHostImplementationMap } from "@ryot/sandbox-sdk/core";
import { DateTime, Effect, Option } from "effect";

import { NotificationsService } from "#modules/notifications/service";
import { SignalEmissionService } from "#modules/signals/service";

import {
	requireSubscriptionSandboxRunInput,
	requireUserSandboxRunInput,
	sandboxHostEffect,
	sandboxHostFailure,
	type SandboxRunInput,
} from "./shared";

export const makeAutomationSandboxApiFunctions = (): Effect.Effect<
	AutomationSandboxHostImplementationMap<SandboxRunInput>,
	never,
	NotificationsService | SignalEmissionService
> =>
	Effect.gen(function* () {
		const notifications = yield* NotificationsService;
		const signals = yield* SignalEmissionService;

		return {
			emitSignal: (rawInput, request) =>
				Effect.gen(function* () {
					const input = yield* requireSubscriptionSandboxRunInput(rawInput, "emitSignal");
					const occurredAt = DateTime.make(input.subscriptionRun.occurredAt);
					if (Option.isNone(occurredAt)) {
						return yield* sandboxHostFailure("emitSignal received an invalid occurrence time");
					}

					return yield* sandboxHostEffect(
						signals
							.emit({
								properties: request.properties,
								schemaSlug: request.schemaSlug,
								origin: input.subscriptionRun.origin,
								discriminator: request.discriminator,
								executionId: input.subscriptionRun.id,
								occurredAt: DateTime.toDate(occurredAt.value),
								principal: input.userId
									? { kind: "user", userId: UserId.make(input.userId) }
									: { kind: "system" },
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
			sendNotification: (rawInput, message) =>
				Effect.gen(function* () {
					const subscriptionInput = yield* requireSubscriptionSandboxRunInput(
						rawInput,
						"sendNotification",
					);
					const input = yield* requireUserSandboxRunInput(subscriptionInput, "sendNotification");
					return yield* sandboxHostEffect(
						notifications
							.sendMessage({
								message: message.trim(),
								userId: UserId.make(input.userId),
								executionId: `${input.subscriptionRun.id}-notification`,
							})
							.pipe(Effect.as(null)),
					);
				}),
		} satisfies AutomationSandboxHostImplementationMap<SandboxRunInput>;
	});
