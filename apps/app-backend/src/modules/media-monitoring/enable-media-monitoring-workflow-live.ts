import { Activity } from "@effect/workflow";
import { DbError } from "@ryot/contract/errors";
import { RelationshipSnapshot } from "@ryot/contract/modules/automations/schemas";
import { RelationshipSchemaId } from "@ryot/contract/schema/brands";
import { DateTime, Effect, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { dispatchLifecycleSubscriptions } from "#modules/automations/lifecycle-dispatch";
import { CollectionsRepository } from "#modules/collections/repository";
import { CollectionsService } from "#modules/collections/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsService } from "#modules/relationships/service";

import {
	EnableMediaMonitoringWorkflow,
	EnableMediaMonitoringWorkflowError,
	type EnableMediaMonitoringWorkflowPayload,
} from "./enable-media-monitoring-workflow";

const WriteMediaMonitoringResult = Schema.Struct({
	createdAt: Schema.optional(Schema.String),
	relationshipSchemaId: RelationshipSchemaId,
	after: Schema.optional(RelationshipSnapshot),
	before: Schema.optional(RelationshipSnapshot),
	operation: Schema.Literal("create", "update", "noop"),
});

const writeMediaMonitoring = Effect.fn("writeMediaMonitoring")(function* (
	payload: EnableMediaMonitoringWorkflowPayload,
) {
	const runWithDb = yield* DbRunner;
	const collections = yield* CollectionsService;
	const relationships = yield* RelationshipsService;
	const collectionsRepository = yield* CollectionsRepository;
	const relationshipSchemas = yield* RelationshipSchemasRepository;
	const { userId, entityId } = payload;

	yield* collections.ensureEntityInLibrary(userId, entityId);

	const mediaMonitoring = yield* runWithDb(
		relationshipSchemas.findBuiltinBySlug("media-monitoring"),
	);
	if (!mediaMonitoring) {
		return yield* Effect.die("media-monitoring relationship schema not found");
	}

	const libraryEntityId = yield* runWithDb(
		collectionsRepository.getUserLibraryEntityId({ userId }),
	);
	if (!libraryEntityId) {
		return yield* Effect.die("Library entity not found for user");
	}

	const outcome = yield* relationships
		.save({
			validation: "schema",
			userId,
			scope: "user",
			properties: {},
			sourceEntityId: entityId,
			onConflict: "preserveExisting",
			targetEntityId: libraryEntityId,
			relationshipSchemaId: mediaMonitoring.id,
			propertiesSchema: mediaMonitoring.propertiesSchema,
		})
		.pipe(Effect.catchTag("BadRequest", (error) => Effect.die(error)));

	return {
		operation: outcome.operation,
		relationshipSchemaId: mediaMonitoring.id,
		...(outcome.after ? { after: outcome.after } : {}),
		...(outcome.before ? { before: outcome.before } : {}),
		...(outcome.operation === "create" ? { createdAt: outcome.relationship.createdAt } : {}),
	};
});

export const runEnableMediaMonitoringWorkflow = Effect.fn("runEnableMediaMonitoringWorkflow")(
	function* (payload: EnableMediaMonitoringWorkflowPayload) {
		const result = yield* Activity.make({
			name: "write-media-monitoring",
			success: WriteMediaMonitoringResult,
			execute: writeMediaMonitoring(payload),
			error: EnableMediaMonitoringWorkflowError,
		});

		if (result.operation === "create" && result.after) {
			const occurrenceId = `relationship-create-${result.after.id}`;
			yield* dispatchLifecycleSubscriptions({
				userId: payload.userId,
				correlationId: occurrenceId,
				target: { kind: "relationship", schemaId: result.relationshipSchemaId },
				automation: {
					occurrenceId,
					automationDepth: 1,
					operation: "create",
					origin: { kind: "api" },
					source: { kind: "relationship", after: result.after },
					...(result.createdAt ? { committedAt: DateTime.unsafeMake(result.createdAt) } : {}),
				},
			}).pipe(
				Effect.mapError(
					() => new DbError({ message: "Media monitoring subscription dispatch failed" }),
				),
			);
		}

		return { entityId: payload.entityId, isMediaMonitored: true };
	},
);

export const EnableMediaMonitoringWorkflowDefinitionsLive = EnableMediaMonitoringWorkflow.toLayer(
	(payload) => runEnableMediaMonitoringWorkflow(payload),
);
