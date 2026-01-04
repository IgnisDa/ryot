import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { unknownToMessage } from "@ryot/contract/errors";
import { SendNotificationPayload } from "@ryot/contract/modules/automations/schemas";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect, Runtime, Schema } from "effect";

import { AutomationsService } from "#modules/automations/service";
import { NotificationDeliveryWorkflow } from "#modules/notifications/notification-delivery-workflow";

import { finishAutomationEffect, reserveAutomationEffect } from "./effect-ledger";
import { type BoundHostFunction, requireUserSandboxRunInput, runHostEffect } from "./shared";

const decodeSendNotificationPayload = Schema.decodeUnknown(SendNotificationPayload);

export const makeNotificationSandboxApiFunctions = (): Effect.Effect<
	Record<string, BoundHostFunction>,
	never,
	AutomationsService | WorkflowEngine
> =>
	Effect.gen(function* () {
		const runtime = yield* Effect.runtime();
		const workflowEngine = yield* WorkflowEngine;
		const automations = yield* AutomationsService;
		const runPromise = Runtime.runPromise(runtime);

		return {
			sendNotification: (...args) => {
				const body = args[0];
				const input = requireUserSandboxRunInput(args, 1, "sendNotification");
				return runHostEffect(
					runPromise,
					decodeSendNotificationPayload(body).pipe(
						Effect.flatMap((payload) =>
							Effect.gen(function* () {
								if (input.executionKind !== "subscription" || !input.automationRun) {
									return yield* Effect.fail("sendNotification requires subscription execution");
								}
								const reservation = yield* reserveAutomationEffect({
									automations,
									correlationUnits: 0,
									validatedInput: payload,
									mapError: unknownToMessage,
									effectKey: payload.effectKey,
									runId: input.automationRun.runId,
									hostFunction: "sendNotification",
									correlationId: input.automationRun.correlationId,
									missingEffectKeyMessage:
										"sendNotification requires an effect key in subscriptions",
								});
								if (reservation.kind === "existing") {
									return reservation.result;
								}
								const executionId = `${input.executionId}-notification-${reservation.effectId}`;
								yield* workflowEngine.execute(NotificationDeliveryWorkflow, {
									executionId,
									discard: true,
									payload: {
										executionId,
										userId: UserId.make(input.userId),
										request: { kind: "automation", message: payload.message },
									},
								});
								const result = { executionId };
								yield* finishAutomationEffect({
									result,
									automations,
									mapError: unknownToMessage,
									effectId: reservation.effectId,
									downstreamExecutionId: executionId,
								});
								return result;
							}),
						),
					),
				);
			},
		};
	});
