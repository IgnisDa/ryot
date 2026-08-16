import { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import type { AutomationSandboxHostImplementationMap } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "effect";

import { Database } from "#lib/infrastructure/db/service";
import {
	requireSandboxCapabilityInput,
	reportSandboxLifecycleWarnings,
	sandboxLifecycleCommand,
	sandboxHostEffect,
	sandboxHostFailure,
	type SandboxRunInput,
} from "#lib/infrastructure/sandbox-runtime/shared";
import { SignalEmissionService } from "#modules/automations/signal-service";
import { NotificationsService } from "#modules/notifications/service";

export const makeAutomationSandboxApiFunctions: Effect.Effect<
	AutomationSandboxHostImplementationMap<SandboxRunInput>,
	never,
	Database | NotificationsService | SignalEmissionService
> = Effect.gen(function* () {
	const database = yield* Database;
	const signals = yield* SignalEmissionService;
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
		emitSignal: (rawInput, request) =>
			requireSandboxCapabilityInput(rawInput, "emitSignal").pipe(
				Effect.flatMap((input) =>
					Effect.gen(function* () {
						const command = yield* sandboxLifecycleCommand(
							input,
							"api",
							`emitSignal:${request.discriminator}`,
						);
						const result = yield* sandboxHostEffect(
							signals
								.emitSignal({
									command,
									properties: request.properties,
									schemaSlug: request.schemaSlug,
									...(request.subjectEntityId
										? { subjectEntityId: EntityId.make(request.subjectEntityId) }
										: {}),
									principal:
										input.principal.subject.type === "automation-run" &&
										input.principal.subject.executionUserId !== null
											? {
													kind: "user",
													userId: UserId.make(input.principal.subject.executionUserId),
												}
											: { kind: "system" },
								})
								.pipe(Effect.provideService(Database, database)),
						);
						yield* reportSandboxLifecycleWarnings("emitSignal", result.warnings);
						return { triggerId: result.triggerId, wasCreated: result.wasCreated };
					}),
				),
			),
	} satisfies AutomationSandboxHostImplementationMap<SandboxRunInput>;
});
