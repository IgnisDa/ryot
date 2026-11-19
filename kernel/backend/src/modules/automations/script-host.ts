import { EntityId, SignalSchemaSlug, UserId } from "@ryot-app/contract/schema/brands";
import type { AutomationSandboxHostImplementationMap } from "@ryot-app/plugin-backend-sdk/core";
import { sandboxHostEffect, sandboxHostFailure } from "@ryot-app/sandbox/host/invocation";
import { Effect } from "effect";

import {
	requireSandboxCapabilityInput,
	type ScriptRunInput,
} from "#modules/scripts/authorization/capabilities";
import { principalOwner } from "#modules/scripts/authorization/principal";
import {
	reportSandboxLifecycleWarnings,
	sandboxLifecycleCommand,
} from "#modules/scripts/host/execution-context";

import { SignalEmissionService } from "./signal-service";

export const makeSignalScriptHost = Effect.gen(function* () {
	const signals = yield* SignalEmissionService;

	return {
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
									reference: {
										owner: principalOwner(input.principal),
										slug: SignalSchemaSlug.make(request.schemaSlug),
									},
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
								.pipe(
									Effect.catchTag("ManagedAssetReferenceRejected", () =>
										sandboxHostFailure("Signal properties reference a forbidden managed asset", {
											code: "asset-forbidden",
										}),
									),
								),
						);
						yield* reportSandboxLifecycleWarnings("emitSignal", result.warnings);
						return { triggerId: result.triggerId, wasCreated: result.wasCreated };
					}),
				),
			),
	} satisfies Pick<AutomationSandboxHostImplementationMap<ScriptRunInput>, "emitSignal">;
});
