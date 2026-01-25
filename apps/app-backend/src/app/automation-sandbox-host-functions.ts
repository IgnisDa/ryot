import { AutomationOrigin } from "@ryot/contract/modules/automations/schemas";
import { EntityId, UserId } from "@ryot/contract/schema/brands";
import { automationInputSchema } from "@ryot/sandbox-sdk/automation";
import type { AutomationSandboxHostImplementationMap } from "@ryot/sandbox-sdk/core";
import { DateTime, Effect, Option, Schema } from "effect";

import {
	requireSubscriptionSandboxRunInput,
	requireUserSandboxRunInput,
	sandboxHostEffect,
	sandboxHostFailure,
	type SandboxRunInput,
} from "#lib/infrastructure/sandbox-runtime/shared";
import { NotificationsService } from "#modules/notifications/service";
import { SignalEmissionService } from "#modules/signals/service";

export const makeAutomationSandboxApiFunctions = (): Effect.Effect<
	AutomationSandboxHostImplementationMap<SandboxRunInput>,
	never,
	NotificationsService | SignalEmissionService
> =>
	Effect.gen(function* () {
		const signals = yield* SignalEmissionService;
		const notifications = yield* NotificationsService;

		return {
			emitSignal: (rawInput, request) =>
				Effect.gen(function* () {
					if (rawInput.authority.type === "user") {
						return yield* sandboxHostFailure(
							"emitSignal is available only to subscription or system executions",
						);
					}
					const execution =
						rawInput.authority.type === "subscription"
							? rawInput.authority.subscriptionRun
							: yield* Schema.decodeUnknown(automationInputSchema)(rawInput.context).pipe(
									Effect.flatMap(({ automation }) =>
										Schema.decodeUnknown(AutomationOrigin)(automation.origin).pipe(
											Effect.map((origin) => ({
												origin,
												id: rawInput.executionId,
												occurredAt: automation.occurredAt,
											})),
										),
									),
									Effect.mapError(() => ({
										message: "emitSignal requires a trusted automation context",
									})),
								);
					const occurredAt = DateTime.make(execution.occurredAt);
					if (Option.isNone(occurredAt)) {
						return yield* sandboxHostFailure("emitSignal received an invalid occurrence time");
					}

					return yield* sandboxHostEffect(
						signals
							.emit({
								origin: execution.origin,
								executionId: execution.id,
								properties: request.properties,
								schemaSlug: request.schemaSlug,
								discriminator: request.discriminator,
								occurredAt: DateTime.toDate(occurredAt.value),
								...(request.subjectEntityId
									? { subjectEntityId: EntityId.make(request.subjectEntityId) }
									: {}),
								principal:
									rawInput.authority.type === "subscription"
										? { kind: "user", userId: UserId.make(rawInput.authority.userId) }
										: { kind: "system" },
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
								userId: UserId.make(input.authority.userId),
								executionId: `${input.authority.subscriptionRun.id}-notification`,
							})
							.pipe(Effect.as(null)),
					);
				}),
		} satisfies AutomationSandboxHostImplementationMap<SandboxRunInput>;
	});
