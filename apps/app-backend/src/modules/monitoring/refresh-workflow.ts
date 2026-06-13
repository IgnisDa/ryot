import { Activity, Workflow } from "@effect/workflow";
import { SandboxRunError, unknownToMessage } from "@ryot/contract/errors";
import { EntityId, EntitySchemaId, SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { synchronizeProviderEntity } from "#modules/entity-import/provider-entity-synchronizer";
import { NotificationsService } from "#modules/notifications/service";

import { diffMonitoringSnapshots, MonitoringSnapshot } from "./diff";
import { MonitoringRepository, type MonitoringTarget } from "./repository";

export const MonitoringRefreshPayload = Schema.Struct({
	entityId: EntityId,
	externalId: Schema.String,
	executionId: Schema.String,
	entitySchemaId: EntitySchemaId,
	entitySchemaSlug: Schema.String,
	sandboxScriptId: SandboxScriptId,
});

export type MonitoringRefreshPayload = typeof MonitoringRefreshPayload.Type;

const asSandboxRunError = (error: unknown) =>
	error instanceof SandboxRunError
		? error
		: new SandboxRunError({ message: unknownToMessage(error) });

const MonitoringSnapshotValue = Schema.NullOr(MonitoringSnapshot);

export const MonitoringRefreshWorkflow = Workflow.make({
	success: Schema.Void,
	error: SandboxRunError,
	payload: MonitoringRefreshPayload,
	name: "MonitoringRefreshWorkflow",
	idempotencyKey: ({ executionId }) => executionId,
});

export const runMonitoringRefreshWorkflow = Effect.fn("runMonitoringRefreshWorkflow")(function* (
	payload: MonitoringRefreshPayload,
) {
	const runWithDb = yield* DbRunner;
	const repository = yield* MonitoringRepository;
	const notifications = yield* NotificationsService;
	const loadSnapshot = (entityId: EntityId, phase: "after" | "before") =>
		Activity.make({
			error: SandboxRunError,
			success: MonitoringSnapshotValue,
			name: `monitoring-load-${phase}-snapshot-${entityId}`,
			execute: runWithDb(repository.getSnapshot(entityId)).pipe(Effect.mapError(asSandboxRunError)),
		});
	const loadSubscribers = (entityId: EntityId, phase: "initial" | "refreshed") =>
		Activity.make({
			error: SandboxRunError,
			success: Schema.Array(Schema.String),
			name: `monitoring-list-${phase}-subscribers-${entityId}`,
			execute: runWithDb(repository.listSubscribers(entityId)).pipe(
				Effect.map((ids) => ids.map(String)),
				Effect.mapError(asSandboxRunError),
			),
		});

	const initialSubscribers = yield* loadSubscribers(payload.entityId, "initial");
	if (initialSubscribers.length === 0) {
		return;
	}
	const before = yield* loadSnapshot(payload.entityId, "before");

	const importPayload = {
		userId: null,
		externalId: payload.externalId,
		executionId: payload.executionId,
		scriptId: payload.sandboxScriptId,
		entitySchemaId: payload.entitySchemaId,
	};
	yield* synchronizeProviderEntity(importPayload, payload.executionId, {
		mode: "refresh",
		entitySchemaSlug: payload.entitySchemaSlug,
		activityPrefix: `monitoring-${payload.entityId}-`,
		childEntitySchemaSlugs: {
			show: "show-season",
			podcast: "podcast-episode",
			"show-season": "show-episode",
		},
	}).pipe(Effect.mapError(asSandboxRunError));

	const after = yield* loadSnapshot(payload.entityId, "after");
	if (!before || !after) {
		return;
	}

	const changes = diffMonitoringSnapshots(before, after);
	if (changes.length === 0) {
		return;
	}

	const subscribers = yield* loadSubscribers(payload.entityId, "refreshed");

	for (const change of changes) {
		for (const userId of subscribers) {
			yield* Activity.make({
				success: Schema.Void,
				error: SandboxRunError,
				name: `monitoring-notification-${payload.entityId}-${change.fingerprint}-${userId}`,
				execute: notifications
					.trigger({
						message: change.message,
						eventType: change.eventType,
						userId: UserId.make(userId),
						executionId: `${payload.executionId}-${userId}-${change.fingerprint}`,
					})
					.pipe(Effect.mapError(asSandboxRunError)),
			});
		}
	}
});

export const MonitoringRefreshWorkflowDefinitionsLive = Layer.mergeAll(
	MonitoringRefreshWorkflow.toLayer((payload) => runMonitoringRefreshWorkflow(payload)),
);

export const monitoringPayloadFromTarget = (target: MonitoringTarget, executionId: string) => ({
	executionId,
	entityId: target.entityId,
	externalId: target.externalId,
	entitySchemaId: target.entitySchemaId,
	sandboxScriptId: target.sandboxScriptId,
	entitySchemaSlug: target.entitySchemaSlug,
});
