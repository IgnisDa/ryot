import { AutomationOrigin } from "@ryot/contract/modules/automations/schemas";
import { EntityId, SubscriptionRunId, UserId } from "@ryot/contract/schema/brands";
import { automationInputSchema } from "@ryot/sandbox-sdk/automation";
import type { AutomationSandboxHostImplementationMap } from "@ryot/sandbox-sdk/core";
import { DateTime, Effect, Option, Schema } from "effect";

import {
	requireSandboxCapabilityInput,
	sandboxHostEffect,
	sandboxHostFailure,
	toSandboxHostError,
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
				Effect.flatMap((input) =>
					Effect.gen(function* () {
						const execution =
							input.authority.type === "subscription"
								? input.authority.subscriptionRun
								: yield* Schema.decodeUnknownEffect(automationInputSchema)(input.context).pipe(
										Effect.flatMap(({ automation }) =>
											Schema.decodeUnknownEffect(AutomationOrigin)(automation.origin).pipe(
												Effect.map((origin) => ({
													origin,
													occurredAt: automation.occurredAt,
													id: SubscriptionRunId.make(input.executionId),
												})),
											),
										),
										Effect.mapError(() =>
											toSandboxHostError("emitSignal requires a trusted automation context"),
										),
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
										input.authority.type === "subscription"
											? { kind: "user", userId: UserId.make(input.authority.userId) }
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
				),
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
