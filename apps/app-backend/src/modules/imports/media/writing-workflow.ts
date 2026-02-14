import { Activity } from "@effect/workflow";
import { unknownToMessage } from "@ryot/contract/errors";
import {
	EntityId,
	EntitySchemaSlug,
	EventSchemaSlug,
	type IntegrationId,
} from "@ryot/contract/schema/brands";
import { DateTime, Effect, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { CollectionsService } from "#modules/collections/service";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import { EventsService } from "#modules/events/service";
import { OperationsService } from "#modules/plugins/operations-service";

import type { ImportRunJobData } from "../jobs";
import { ImportRunError, toWorkflowError } from "../runtime/workflow-errors";
import { resolveMediaEventTarget } from "./event-target-workflow";
import { mediaEntityGroupItemIndex } from "./groups";
import {
	activityKey,
	type EntityIdsByKey,
	type ProgressReporter,
	WriteOutcome,
} from "./shared-workflow";
import type { ImportMediaEntityGroup } from "./types";
import { importEntityRefKey } from "./types";
import { MediaImportWorkflowOperations } from "./types-workflow";
import { recordWriteFailure } from "./writing-failures-workflow";

export const writeMediaEntityGroups = Effect.fn("writeMediaEntityGroups")(function* (input: {
	executionId: string;
	entityIdsByKey: EntityIdsByKey;
	reportProgress: ProgressReporter;
	entityGroups: ImportMediaEntityGroup[];
	payload: Pick<ImportRunJobData, "runId" | "userId"> & { integrationId?: IntegrationId };
}) {
	const runWithDb = yield* DbRunner;
	const events = yield* EventsService;
	const collections = yield* CollectionsService;
	const operations = yield* MediaImportWorkflowOperations;
	const eventSchemas = yield* EventSchemasRepository;
	const entitySchemas = yield* EntitySchemasRepository;
	const pluginOperations = yield* OperationsService;
	let failures = 0;
	let importedItems = 0;
	const collectionIdsByName = new Map<string, EntityId>();
	const eventSchemaSlugsByKey = new Map<string, EventSchemaSlug>();
	const entitySchemaSlugsBySlug = new Map<string, EntitySchemaSlug>();
	const ownershipSyncedAt = yield* Activity.make({
		error: ImportRunError,
		success: Schema.String,
		name: "capture-ownership-synced-at",
		execute: DateTime.nowAsDate.pipe(
			Effect.map((date) => date.toISOString()),
			Effect.mapError(toWorkflowError),
		),
	});

	const getEntitySchemaSlug = (schemaSlug: string) =>
		Effect.gen(function* () {
			const cached = entitySchemaSlugsBySlug.get(schemaSlug);
			if (cached) {
				return cached;
			}

			const loadedSlug = yield* Activity.make({
				error: ImportRunError,
				success: Schema.NullOr(EntitySchemaSlug),
				name: `load-entity-schema-${activityKey(schemaSlug)}`,
				execute: runWithDb(entitySchemas.getBuiltinBySlug(schemaSlug)).pipe(
					Effect.map((found) => found?.id ?? null),
					Effect.mapError(toWorkflowError),
				),
			});
			if (loadedSlug) {
				entitySchemaSlugsBySlug.set(schemaSlug, loadedSlug);
			}

			return loadedSlug;
		});

	const getCollectionId = (collectionName: string) =>
		Effect.gen(function* () {
			const cached = collectionIdsByName.get(collectionName);
			if (cached) {
				return cached;
			}

			const collectionId = yield* Activity.make({
				success: EntityId,
				error: ImportRunError,
				name: `get-or-create-collection-${activityKey(collectionName)}`,
				execute: collections.getOrCreateCollection(input.payload.userId, collectionName).pipe(
					Effect.map((collection) => collection.id),
					Effect.mapError(toWorkflowError),
				),
			});
			collectionIdsByName.set(collectionName, collectionId);
			return collectionId;
		});

	const getEventSchemaSlug = (entitySchemaSlug: EntitySchemaSlug, eventSlug: string) =>
		Effect.gen(function* () {
			const schemaKey = `${entitySchemaSlug}:${eventSlug}`;
			const cached = eventSchemaSlugsByKey.get(schemaKey);
			if (cached) {
				return cached;
			}

			const loadedSlug = yield* Activity.make({
				error: ImportRunError,
				success: Schema.NullOr(EventSchemaSlug),
				name: `load-event-schema-${activityKey(schemaKey)}`,
				execute: runWithDb(
					eventSchemas.getBuiltinBySlug({ entitySchemaSlug, slug: eventSlug }),
				).pipe(
					Effect.map((found) => found?.id ?? null),
					Effect.mapError(toWorkflowError),
				),
			});
			if (loadedSlug) {
				eventSchemaSlugsByKey.set(schemaKey, loadedSlug);
			}

			return loadedSlug;
		});

	const writeCollectionMemberships = (writeInput: {
		groupIndex: number;
		itemIndex: number;
		entityId: EntityId;
		group: ImportMediaEntityGroup;
		ref: Extract<ImportMediaEntityGroup["entityRef"], { kind: "resolved" }>;
	}) =>
		Effect.gen(function* () {
			let groupFailed = false;

			for (
				let membershipIndex = 0;
				membershipIndex < writeInput.group.collectionMemberships.length;
				membershipIndex += 1
			) {
				const membership = writeInput.group.collectionMemberships[membershipIndex];
				if (!membership) {
					continue;
				}

				const collectionId = yield* getCollectionId(membership.collectionName).pipe(Effect.either);
				if (collectionId._tag === "Left") {
					groupFailed = true;
					yield* recordWriteFailure({
						payload: input.payload,
						ref: writeInput.ref,
						itemIndex: writeInput.itemIndex,
						message: collectionId.left.message,
						name: `record-collection-lookup-failure-${writeInput.groupIndex}-${membershipIndex}`,
					});
					continue;
				}

				const membershipResult = yield* operations
					.writeCollectionMembership({
						userId: input.payload.userId,
						entityId: writeInput.entityId,
						collectionId: collectionId.right,
						executionId: `${input.executionId}-collection-${writeInput.groupIndex}-${membershipIndex}`,
					})
					.pipe(
						Effect.as({ message: null as string | null }),
						Effect.catchAll((error) => Effect.succeed({ message: unknownToMessage(error) })),
					);
				if (membershipResult.message) {
					groupFailed = true;
					yield* recordWriteFailure({
						payload: input.payload,
						ref: writeInput.ref,
						itemIndex: writeInput.itemIndex,
						message: membershipResult.message,
						name: `record-collection-write-failure-${writeInput.groupIndex}-${membershipIndex}`,
					});
				}
			}

			return groupFailed;
		});

	const writeEvent = (eventInput: {
		eventIndex: number;
		groupIndex: number;
		itemIndex: number;
		entityId: EntityId;
		entitySchemaSlug: EntitySchemaSlug;
		event: ImportMediaEntityGroup["events"][number];
		ref: Extract<ImportMediaEntityGroup["entityRef"], { kind: "resolved" }>;
	}) =>
		Effect.gen(function* () {
			const target = yield* resolveMediaEventTarget({
				...eventInput,
				payload: input.payload,
				getEntitySchemaSlug,
				operations: pluginOperations,
			});
			if (target._tag === "failed") {
				return true;
			}

			const eventSchemaSlug = yield* getEventSchemaSlug(
				target.entitySchemaSlug,
				eventInput.event.eventSchemaSlug,
			);
			if (!eventSchemaSlug) {
				yield* recordWriteFailure({
					payload: input.payload,
					ref: eventInput.ref,
					itemIndex: eventInput.itemIndex,
					eventSchemaSlug: eventInput.event.eventSchemaSlug,
					entitySchemaSlug: target.entitySchemaSlug,
					name: `record-event-schema-missing-${eventInput.groupIndex}-${eventInput.eventIndex}`,
					message: `Event schema not found: ${eventInput.event.eventSchemaSlug}`,
				});
				return true;
			}

			const eventPayload = [
				{
					eventSchemaSlug,
					entityId: target.entityId,
					occurredAt: eventInput.event.occurredAt,
					properties: eventInput.event.properties,
				},
			];
			const eventExecutionId = `${input.executionId}-event-${eventInput.groupIndex}-${eventInput.eventIndex}`;
			const eventWrite = yield* events
				.create({
					payload: eventPayload,
					userId: input.payload.userId,
					executionId: eventExecutionId,
					source: input.payload.integrationId ? "integration" : "import",
					metadata: {
						importRunId: input.payload.runId,
						...(input.payload.integrationId ? { integrationId: input.payload.integrationId } : {}),
					},
				})
				.pipe(
					Effect.map(({ failure }) => ({ message: failure?.reason.message ?? null })),
					Effect.catchAll((error) => Effect.succeed({ message: unknownToMessage(error) })),
				);
			if (eventWrite.message) {
				yield* recordWriteFailure({
					payload: input.payload,
					ref: eventInput.ref,
					itemIndex: eventInput.itemIndex,
					message: eventWrite.message,
					eventSchemaSlug: eventInput.event.eventSchemaSlug,
					entitySchemaSlug: target.entitySchemaSlug,
					name: `record-event-write-failure-${eventInput.groupIndex}-${eventInput.eventIndex}`,
				});
				return true;
			}

			return false;
		});

	const writeEvents = (writeInput: {
		groupIndex: number;
		itemIndex: number;
		entityId: EntityId;
		entitySchemaSlug: EntitySchemaSlug;
		group: ImportMediaEntityGroup;
		ref: Extract<ImportMediaEntityGroup["entityRef"], { kind: "resolved" }>;
	}) =>
		Effect.gen(function* () {
			let groupFailed = false;

			for (let eventIndex = 0; eventIndex < writeInput.group.events.length; eventIndex += 1) {
				const event = writeInput.group.events[eventIndex];
				if (!event) {
					continue;
				}

				const eventFailed = yield* writeEvent({
					event,
					eventIndex,
					ref: writeInput.ref,
					entityId: writeInput.entityId,
					itemIndex: writeInput.itemIndex,
					groupIndex: writeInput.groupIndex,
					entitySchemaSlug: writeInput.entitySchemaSlug,
				});
				if (eventFailed) {
					groupFailed = true;
				}
			}

			return groupFailed;
		});

	const markOwnership = (writeInput: {
		groupIndex: number;
		itemIndex: number;
		entityId: EntityId;
		group: ImportMediaEntityGroup;
		ref: Extract<ImportMediaEntityGroup["entityRef"], { kind: "resolved" }>;
	}) =>
		Effect.gen(function* () {
			if (!writeInput.group.ownershipProvider) {
				return false;
			}

			const ownershipResult = yield* Activity.make({
				name: `mark-library-ownership-${writeInput.groupIndex}`,
				success: WriteOutcome,
				execute: collections
					.markEntityOwnedInLibrary({
						syncedAt: ownershipSyncedAt,
						entityId: writeInput.entityId,
						userId: input.payload.userId,
						provider: writeInput.group.ownershipProvider,
					})
					.pipe(
						Effect.as({ message: null }),
						Effect.catchAll((error) => Effect.succeed({ message: unknownToMessage(error) })),
					),
			});
			if (!ownershipResult.message) {
				return false;
			}

			yield* recordWriteFailure({
				payload: input.payload,
				ref: writeInput.ref,
				itemIndex: writeInput.itemIndex,
				message: ownershipResult.message,
				name: `record-ownership-write-failure-${writeInput.groupIndex}`,
			});
			return true;
		});

	for (let i = 0; i < input.entityGroups.length; i += 1) {
		const group = input.entityGroups[i];
		const ref = group?.entityRef;
		if (!group || ref?.kind !== "resolved") {
			yield* input.reportProgress(i + 1);
			continue;
		}

		const entityId = input.entityIdsByKey.get(importEntityRefKey(ref));
		if (!entityId) {
			yield* input.reportProgress(i + 1);
			continue;
		}

		const itemIndex = mediaEntityGroupItemIndex(group, i);
		const entitySchemaSlug = yield* getEntitySchemaSlug(ref.entitySchemaSlug);
		if (!entitySchemaSlug) {
			failures += 1;
			yield* recordWriteFailure({
				ref,
				itemIndex,
				payload: input.payload,
				name: `record-entity-schema-missing-${i}`,
				message: `Entity schema not found: ${ref.entitySchemaSlug}`,
			});
			yield* input.reportProgress(i + 1);
			continue;
		}

		let groupFailed = yield* writeCollectionMemberships({
			ref,
			group,
			entityId,
			itemIndex,
			groupIndex: i,
		});
		const eventsFailed = yield* writeEvents({
			ref,
			group,
			entityId,
			itemIndex,
			groupIndex: i,
			entitySchemaSlug,
		});
		const ownershipFailed = yield* markOwnership({
			ref,
			group,
			entityId,
			itemIndex,
			groupIndex: i,
		});
		groupFailed = groupFailed || eventsFailed || ownershipFailed;

		if (groupFailed) {
			failures += 1;
		} else {
			importedItems += 1;
		}

		yield* input.reportProgress(i + 1);
	}

	return { failures, importedItems };
});
