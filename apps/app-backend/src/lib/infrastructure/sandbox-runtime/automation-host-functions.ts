import { EntityId, UserId } from "@ryot/contract/schema/brands";
import type { AutomationSandboxHostImplementationMap } from "@ryot/sandbox-sdk/core";
import { dayjs } from "@ryot/ts-utils/dayjs";
import { Effect, Runtime } from "effect";

import { NotificationsService } from "#modules/notifications/service";
import { SignalEmissionService } from "#modules/signals/service";

import {
	apiFailure,
	requireSubscriptionSandboxRunInput,
	requireUserSandboxRunInput,
	runSandboxHostEffect,
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
		const runtime = yield* Effect.runtime();
		const runPromise = Runtime.runPromise(runtime);

		return {
			emitSignal: (rawInput, request) => {
				const input = requireSubscriptionSandboxRunInput(rawInput, "emitSignal");
				const occurredAt = dayjs(input.subscriptionRun.occurredAt);
				if (!occurredAt.isValid()) {
					return Promise.resolve(apiFailure("emitSignal received an invalid occurrence time"));
				}

				return runSandboxHostEffect(
					runPromise,
					signals
						.emit({
							properties: request.properties,
							schemaSlug: request.schemaSlug,
							occurredAt: occurredAt.toDate(),
							origin: input.subscriptionRun.origin,
							discriminator: request.discriminator,
							executionId: input.subscriptionRun.id,
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
			},
			sendNotification: (rawInput, message) => {
				const subscriptionInput = requireSubscriptionSandboxRunInput(rawInput, "sendNotification");
				const input = requireUserSandboxRunInput(subscriptionInput, "sendNotification");
				return runSandboxHostEffect(
					runPromise,
					notifications
						.sendMessage({
							message: message.trim(),
							userId: UserId.make(input.userId),
							executionId: `${input.subscriptionRun.id}-notification`,
						})
						.pipe(Effect.as(null)),
				);
			},
		} satisfies AutomationSandboxHostImplementationMap<SandboxRunInput>;
	});
