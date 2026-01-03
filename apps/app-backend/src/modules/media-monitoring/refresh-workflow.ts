import { Activity, DurableClock, Workflow } from "@effect/workflow";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { SandboxRunError, unknownToMessage } from "@ryot/contract/errors";
import { EntityId, EntitySchemaId, SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { Cause, Effect, Exit, Layer, Schedule, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { ProviderEntityPopulationWorkflow } from "#modules/entity-import/provider-entity-population-workflow";
import { NotificationDeliveryWorkflow } from "#modules/notifications/notification-delivery-workflow";

import { diffMediaMonitoringSnapshots, MediaMonitoringSnapshot } from "./diff";
import { MediaMonitoringRepository, type MediaMonitoringTarget } from "./repository";

export const MediaMonitoringRefreshPayload = Schema.Struct({
	entityId: EntityId,
	externalId: Schema.String,
	executionId: Schema.String,
	entitySchemaId: EntitySchemaId,
	entitySchemaSlug: Schema.String,
	sandboxScriptId: SandboxScriptId,
});

export type MediaMonitoringRefreshPayload = typeof MediaMonitoringRefreshPayload.Type;

const asSandboxRunError = (error: unknown) =>
	error instanceof SandboxRunError
		? error
		: new SandboxRunError({ message: unknownToMessage(error) });

const POST_REFRESH_RETRY_SCHEDULE = Schedule.spaced("30 seconds");
const MediaMonitoringSnapshotValue = Schema.NullOr(MediaMonitoringSnapshot);

export const MediaMonitoringRefreshWorkflow = Workflow.make({
	success: Schema.Void,
	error: SandboxRunError,
	name: "MediaMonitoringRefreshWorkflow",
	payload: MediaMonitoringRefreshPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

export const runMediaMonitoringRefreshWorkflow = Effect.fn("runMediaMonitoringRefreshWorkflow")(
	function* (payload: MediaMonitoringRefreshPayload) {
		const runWithDb = yield* DbRunner;
		const engine = yield* WorkflowEngine;
		const repository = yield* MediaMonitoringRepository;
		const loadSnapshot = (entityId: EntityId, phase: "after" | "before") => {
			const execute = runWithDb(repository.getSnapshot(entityId)).pipe(
				Effect.mapError(asSandboxRunError),
			);
			return Activity.make({
				error: SandboxRunError,
				success: MediaMonitoringSnapshotValue,
				name: `media-monitoring-load-${phase}-snapshot-${entityId}`,
				execute:
					phase === "after" ? execute.pipe(Effect.retry(POST_REFRESH_RETRY_SCHEDULE)) : execute,
			});
		};
		const loadSubscribers = (entityId: EntityId, phase: "initial" | "refreshed") => {
			const execute = runWithDb(repository.listSubscribers(entityId)).pipe(
				Effect.map((ids) => ids.map(String)),
				Effect.mapError(asSandboxRunError),
			);
			return Activity.make({
				error: SandboxRunError,
				success: Schema.Array(Schema.String),
				name: `media-monitoring-list-${phase}-subscribers-${entityId}`,
				execute:
					phase === "refreshed" ? execute.pipe(Effect.retry(POST_REFRESH_RETRY_SCHEDULE)) : execute,
			});
		};

		const initialSubscribers = yield* loadSubscribers(payload.entityId, "initial");
		if (initialSubscribers.length === 0) {
			return;
		}
		const before = yield* loadSnapshot(payload.entityId, "before");

		const refreshExecutionId = `${payload.executionId}-provider-refresh`;
		yield* engine.execute(ProviderEntityPopulationWorkflow, {
			executionId: refreshExecutionId,
			payload: {
				userId: null,
				mode: "refresh",
				externalId: payload.externalId,
				executionId: refreshExecutionId,
				scriptId: payload.sandboxScriptId,
				origin: { kind: "provider_refresh" },
				entitySchemaId: payload.entitySchemaId,
				entitySchemaSlug: payload.entitySchemaSlug,
			},
		});

		const after = yield* loadSnapshot(payload.entityId, "after");
		if (!before || !after) {
			return;
		}

		const changes = diffMediaMonitoringSnapshots(before, after);
		if (changes.length === 0) {
			return;
		}

		const subscribers = yield* loadSubscribers(payload.entityId, "refreshed");

		for (const change of changes) {
			for (const userId of subscribers) {
				const deliveryExecutionId = `${payload.executionId}-${userId}-${change.fingerprint}`;
				for (let attempt = 1; ; attempt += 1) {
					const exit = yield* Effect.exit(
						engine.execute(NotificationDeliveryWorkflow, {
							discard: true,
							executionId: deliveryExecutionId,
							payload: {
								userId: UserId.make(userId),
								executionId: deliveryExecutionId,
								request: { kind: "message", message: change.message },
							},
						}),
					);
					if (Exit.isSuccess(exit)) {
						break;
					}
					if (Cause.isInterrupted(exit.cause)) {
						yield* Effect.failCause(exit.cause).pipe(
							Effect.mapError(asSandboxRunError),
							Effect.asVoid,
						);
					}

					yield* Effect.logError(
						"media monitoring notification dispatch failed",
						userId,
						exit.cause,
					);
					yield* DurableClock.sleep({
						duration: "30 seconds",
						name: `media-monitoring-delivery-${userId}-${change.fingerprint}-retry-${attempt}`,
					});
				}
			}
		}
	},
);

export const MediaMonitoringRefreshWorkflowDefinitionsLive = Layer.mergeAll(
	MediaMonitoringRefreshWorkflow.toLayer((payload) => runMediaMonitoringRefreshWorkflow(payload)),
);

export const mediaMonitoringPayloadFromTarget = (
	target: MediaMonitoringTarget,
	executionId: string,
) => ({
	executionId,
	entityId: target.entityId,
	externalId: target.externalId,
	entitySchemaId: target.entitySchemaId,
	sandboxScriptId: target.sandboxScriptId,
	entitySchemaSlug: target.entitySchemaSlug,
});
