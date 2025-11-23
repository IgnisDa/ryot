import { Activity, Workflow } from "@effect/workflow";
import { SandboxRunError, unknownToMessage } from "@ryot/contract/errors";
import { EntityId, EntitySchemaId, SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { synchronizeProviderEntity } from "#modules/entity-import/provider-entity-synchronizer";
import { NotificationsService } from "#modules/notifications/service";

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

const MediaMonitoringSnapshotValue = Schema.NullOr(MediaMonitoringSnapshot);

export const MediaMonitoringRefreshWorkflow = Workflow.make({
	success: Schema.Void,
	error: SandboxRunError,
	payload: MediaMonitoringRefreshPayload,
	name: "MediaMonitoringRefreshWorkflow",
	idempotencyKey: ({ executionId }) => executionId,
});

export const runMediaMonitoringRefreshWorkflow = Effect.fn("runMediaMonitoringRefreshWorkflow")(
	function* (payload: MediaMonitoringRefreshPayload) {
		const runWithDb = yield* DbRunner;
		const repository = yield* MediaMonitoringRepository;
		const notifications = yield* NotificationsService;
		const loadSnapshot = (entityId: EntityId, phase: "after" | "before") =>
			Activity.make({
				error: SandboxRunError,
				success: MediaMonitoringSnapshotValue,
				name: `media-monitoring-load-${phase}-snapshot-${entityId}`,
				execute: runWithDb(repository.getSnapshot(entityId)).pipe(
					Effect.mapError(asSandboxRunError),
				),
			});
		const loadSubscribers = (entityId: EntityId, phase: "initial" | "refreshed") =>
			Activity.make({
				error: SandboxRunError,
				success: Schema.Array(Schema.String),
				name: `media-monitoring-list-${phase}-subscribers-${entityId}`,
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
			activityPrefix: `media-monitoring-${payload.entityId}-`,
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

		const changes = diffMediaMonitoringSnapshots(before, after);
		if (changes.length === 0) {
			return;
		}

		const subscribers = yield* loadSubscribers(payload.entityId, "refreshed");

		for (const change of changes) {
			for (const userId of subscribers) {
				yield* Activity.make({
					success: Schema.Void,
					error: SandboxRunError,
					name: `media-monitoring-notification-${payload.entityId}-${change.fingerprint}-${userId}`,
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
