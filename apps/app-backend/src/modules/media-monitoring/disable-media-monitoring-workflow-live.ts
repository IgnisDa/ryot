import { Activity } from "@effect/workflow";
import { Effect, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { CollectionsRepository } from "#modules/collections/repository";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsService } from "#modules/relationships/service";

import {
	DisableMediaMonitoringWorkflow,
	DisableMediaMonitoringWorkflowError,
	type DisableMediaMonitoringWorkflowPayload,
} from "./disable-media-monitoring-workflow";

const deleteMediaMonitoring = Effect.fn("deleteMediaMonitoring")(function* (
	payload: DisableMediaMonitoringWorkflowPayload,
) {
	const runWithDb = yield* DbRunner;
	const relationships = yield* RelationshipsService;
	const collectionsRepository = yield* CollectionsRepository;
	const relationshipSchemas = yield* RelationshipSchemasRepository;
	const { userId, entityId } = payload;

	const mediaMonitoring = yield* runWithDb(
		relationshipSchemas.findBuiltinBySlug("media-monitoring"),
	);
	if (!mediaMonitoring) {
		return yield* Effect.die("media-monitoring relationship schema not found");
	}

	const libraryEntityId = yield* runWithDb(
		collectionsRepository.getUserLibraryEntityId({ userId }),
	);
	if (libraryEntityId) {
		yield* relationships.deleteUserRelationship({
			userId,
			sourceEntityId: entityId,
			targetEntityId: libraryEntityId,
			relationshipSchemaId: mediaMonitoring.id,
		});
	}
	return yield* Effect.void;
});

export const runDisableMediaMonitoringWorkflow = Effect.fn("runDisableMediaMonitoringWorkflow")(
	function* (payload: DisableMediaMonitoringWorkflowPayload) {
		yield* Activity.make({
			success: Schema.Void,
			name: "delete-media-monitoring",
			execute: deleteMediaMonitoring(payload),
			error: DisableMediaMonitoringWorkflowError,
		});

		// Monitoring-relationship deletion is intentionally occurrence-free: delete rules are
		// built-in-only and none target this schema. See modules/automations/AGENTS.md
		// ("Write-path ownership" -> occurrence-free carve-outs).
		return { entityId: payload.entityId, isMediaMonitored: false };
	},
);

export const DisableMediaMonitoringWorkflowDefinitionsLive = DisableMediaMonitoringWorkflow.toLayer(
	(payload) => runDisableMediaMonitoringWorkflow(payload),
);
