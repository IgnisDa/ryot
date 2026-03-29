import { SandboxRunError, unknownToMessage } from "@ryot/contract/errors";
import { UserId } from "@ryot/contract/schema/brands";
import { createEventItemSchema } from "@ryot/sandbox-sdk/core";
import {
	type WorkflowDurableResult,
	workflowDurableResultSchema,
} from "@ryot/sandbox-sdk/workflow";
import { Cause, Effect, Layer, Schema } from "effect";
import { Activity } from "effect/unstable/workflow";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { DbRunner } from "#lib/infrastructure/db/service";
import { SandboxHostImplementations } from "#lib/infrastructure/sandbox-runtime/host-implementations";
import { withoutWorkflowParent } from "#lib/infrastructure/workflow";
import {
	EventCreateWorkflow,
	EventCreateWorkflowPayload,
} from "#modules/events/event-create-workflow";
import {
	dispatchSandboxHostActivity,
	durableHostFailure,
	prepareSandboxCreateEvents,
	SandboxDurableHostDispatcher,
} from "#modules/sandbox/durable-host-dispatcher";
import { SandboxRepository } from "#modules/sandbox/repository";

const PreparedSandboxCreateEvents = Schema.Struct({
	userId: UserId,
	executionId: Schema.String,
	payload: Schema.Array(createEventItemSchema),
});

const activityCapabilities = [
	"httpCall",
	"getCachedValue",
	"getPluginConfig",
	"getSystemConfig",
	"getUserPreferences",
	"executeQueryEngine",
	"claimPersistentValue",
	"changeUserRelationships",
] as const;

export const SandboxDurableHostDispatcherLive = Layer.effect(
	SandboxDurableHostDispatcher,
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const engine = yield* WorkflowEngine;
		const repository = yield* SandboxRepository;
		const implementations = yield* SandboxHostImplementations;

		return {
			dispatch: (request, payload, executionId, requestIndex) => {
				const startedAt = payload.startedAt ?? "";
				if (request.args.capability !== "createEvents") {
					if (!activityCapabilities.some((capability) => capability === request.args.capability)) {
						return Effect.fail(
							new SandboxRunError({
								message: `Sandbox durable host capability is not supported yet: ${request.args.capability}`,
							}),
						);
					}
					return Activity.make({
						error: SandboxRunError,
						success: workflowDurableResultSchema,
						name: `sandbox-host-${requestIndex}-${request.args.capability}`,
						execute: dispatchSandboxHostActivity(request, payload, executionId, startedAt).pipe(
							Effect.provideService(DbRunner, runWithDb),
							Effect.provideService(SandboxRepository, repository),
							Effect.provideService(SandboxHostImplementations, implementations),
						),
					});
				}

				return Effect.gen(function* () {
					const prepared = yield* Activity.make({
						error: SandboxRunError,
						success: PreparedSandboxCreateEvents,
						name: `prepare-sandbox-create-events-${requestIndex}`,
						execute: prepareSandboxCreateEvents(request, payload, executionId, startedAt).pipe(
							Effect.provideService(DbRunner, runWithDb),
							Effect.provideService(SandboxRepository, repository),
						),
					});
					const eventPayload = yield* Schema.decodeUnknownEffect(EventCreateWorkflowPayload)({
						...prepared,
						origin: "sandbox",
					}).pipe(
						Effect.mapError(
							(error) =>
								new SandboxRunError({
									message: `Invalid createEvents payload: ${unknownToMessage(error)}`,
								}),
						),
					);
					const result = yield* Effect.exit(
						engine
							.execute(EventCreateWorkflow, {
								payload: eventPayload,
								executionId: eventPayload.executionId,
							})
							.pipe(withoutWorkflowParent),
					);
					if (result._tag === "Failure") {
						if (Cause.hasDies(result.cause) || Cause.hasInterrupts(result.cause)) {
							return yield* Effect.failCause(
								Cause.fromReasons<never>(
									result.cause.reasons.filter(
										(reason): reason is Cause.Die | Cause.Interrupt => !Cause.isFailReason(reason),
									),
								),
							);
						}
						return durableHostFailure(unknownToMessage(result.cause));
					}
					return result.value.failure
						? durableHostFailure(result.value.failure.reason.message)
						: ({
								state: "success",
								value: { count: result.value.count },
							} satisfies WorkflowDurableResult);
				});
			},
		};
	}),
);
