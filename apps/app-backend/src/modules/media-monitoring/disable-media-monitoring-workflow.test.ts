import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import {
	EntityId,
	RelationshipId,
	RelationshipSchemaId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { dbRunnerLayer, makeWorkflowActivityEngine } from "#lib/test-support/effect";
import { CollectionsRepository } from "#modules/collections/repository";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsService } from "#modules/relationships/service";

import {
	DisableMediaMonitoringWorkflow,
	type DisableMediaMonitoringWorkflowPayload,
} from "./disable-media-monitoring-workflow";
import { runDisableMediaMonitoringWorkflow } from "./disable-media-monitoring-workflow-live";

const userId = UserId.make("user-id");
const entityId = EntityId.make("entity-1");
const libraryEntityId = EntityId.make("library-1");
const relationshipSchemaId = RelationshipSchemaId.make("media-monitoring-schema");

const mediaMonitoringSchema = {
	isBuiltin: true,
	name: "Media Monitoring",
	slug: "media-monitoring",
	id: relationshipSchemaId,
	sourceEntitySchemaId: null,
	targetEntitySchemaId: null,
	propertiesSchema: { fields: {} },
};

const now = "2026-06-14T00:00:00.000Z";

const deletedRelationship = {
	properties: {},
	createdAt: now,
	relationshipSchemaId,
	sourceEntityId: entityId,
	targetEntityId: libraryEntityId,
	id: RelationshipId.make("rel-1"),
};

type DeleteCall = {
	userId: UserId;
	sourceEntityId: EntityId;
	targetEntityId: EntityId;
	relationshipSchemaId: RelationshipSchemaId;
};

const runDisableWorkflow = (input: {
	deletes: DeleteCall[];
	dispatches: unknown[];
	libraryEntityId: EntityId | null;
}) => {
	const executionId = "disable-workflow-execution-id";
	const instance = WorkflowInstance.initial(DisableMediaMonitoringWorkflow, executionId);
	const engine = makeWorkflowActivityEngine(instance, {
		execute: (_workflow, options) => {
			input.dispatches.push(options);
			return Effect.succeed(options.executionId);
		},
	});

	const services = Layer.mergeAll(
		dbRunnerLayer,
		Layer.succeed(WorkflowEngine, engine),
		Layer.mock(RelationshipsService, {
			_tag: "RelationshipsService",
			deleteUserRelationship: (call: DeleteCall) => {
				input.deletes.push(call);
				return Effect.succeed(deletedRelationship);
			},
		}),
		Layer.mock(CollectionsRepository, {
			_tag: "CollectionsRepository",
			getUserLibraryEntityId: () => Effect.succeed(input.libraryEntityId),
		}),
		Layer.mock(RelationshipSchemasRepository, {
			_tag: "RelationshipSchemasRepository",
			findBuiltinBySlug: () => Effect.succeed(mediaMonitoringSchema),
		}),
	);

	const payload = {
		userId,
		entityId,
		executionId,
	} satisfies DisableMediaMonitoringWorkflowPayload;

	return runDisableMediaMonitoringWorkflow(payload).pipe(
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(services),
	);
};

it.effect("deletes the monitoring relationship via the service and dispatches nothing", () => {
	const deletes: DeleteCall[] = [];
	const dispatches: unknown[] = [];

	return Effect.gen(function* () {
		const status = yield* runDisableWorkflow({ libraryEntityId, deletes, dispatches });

		expect(status).toEqual({ entityId, isMediaMonitored: false });
		expect(dispatches).toHaveLength(0);
		expect(deletes).toEqual([
			{ userId, sourceEntityId: entityId, targetEntityId: libraryEntityId, relationshipSchemaId },
		]);
	});
});

it.effect("skips the delete when the user has no library entity", () => {
	const deletes: DeleteCall[] = [];
	const dispatches: unknown[] = [];

	return Effect.gen(function* () {
		const status = yield* runDisableWorkflow({ libraryEntityId: null, deletes, dispatches });

		expect(status).toEqual({ entityId, isMediaMonitored: false });
		expect(deletes).toHaveLength(0);
		expect(dispatches).toHaveLength(0);
	});
});
