import { Activity } from "@effect/workflow";
import { DateTime, Effect, Schema } from "effect";

import { defaultUserPreferences } from "#lib/builtins/bootstrap";
import { DbRunner } from "#lib/db/service";
import { unknownToMessage } from "#lib/errors";
import { EntityId, EntitySchemaId, EventSchemaId, type IntegrationId } from "#lib/schema/brands";
import { CollectionsService } from "#modules/collections/service";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { EpisodeResolverService } from "#modules/episode-resolver/service";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import { EventsService } from "#modules/events/service";

import type { ImportRunJobData } from "../jobs";
import { ImportRunError, toWorkflowError } from "../runtime/workflow-helpers";
import { mediaEntityGroupItemIndex } from "./groups";
import type { ImportMediaEntityGroup } from "./types";
import { importEntityRefKey } from "./types";
import {
	activityKey,
	EnsureLibraryMembershipOutcome,
	type EntityIdsByKey,
	type ProgressReporter,
} from "./workflow-shared";
import {
	recordEpisodeResolutionFailure,
	recordEpisodeSchemaMissing,
	recordWriteFailure,
} from "./workflow-writing-failures";

export const writeMediaEntityGroups = Effect.fn("writeMediaEntityGroups")(function* (input: {
	executionId: string;
	entityIdsByKey: EntityIdsByKey;
	reportProgress: ProgressReporter;
	entityGroups: ImportMediaEntityGroup[];
	options: { integrationId?: IntegrationId };
	payload: Pick<ImportRunJobData, "runId" | "userId">;
}) {
	const runWithDb = yield* DbRunner;
	const events = yield* EventsService;
	const collections = yield* CollectionsService;
	const eventSchemas = yield* EventSchemasRepository;
	const entitySchemas = yield* EntitySchemasRepository;
	const episodeResolver = yield* EpisodeResolverService;
	let failures = 0;
	let importedItems = 0;
	const collectionIdsByName = new Map<string, EntityId>();
	const eventSchemaIdsByKey = new Map<string, EventSchemaId>();
	const user = {
		name: "",
		email: "",
		id: input.payload.userId,
		preferences: defaultUserPreferences,
	};
	const entitySchemaIdsBySlug = new Map<string, EntitySchemaId>();
	const ownershipSyncedAt = yield* Activity.make({
		error: ImportRunError,
		success: Schema.String,
		name: "capture-ownership-synced-at",
		execute: DateTime.nowAsDate.pipe(
			Effect.map((date) => date.toISOString()),
			Effect.mapError(toWorkflowError),
		),
	});

	const getEntitySchemaId = (entitySchemaSlug: string) =>
		Effect.gen(function* () {
			const cached = entitySchemaIdsBySlug.get(entitySchemaSlug);
			if (cached) {
				return cached;
			}

			const entitySchemaId = yield* Activity.make({
				error: ImportRunError,
				success: Schema.NullOr(EntitySchemaId),
				name: `load-entity-schema-${activityKey(entitySchemaSlug)}`,
				execute: runWithDb(entitySchemas.getBuiltinBySlug(entitySchemaSlug)).pipe(
					Effect.map((found) => found?.id ?? null),
					Effect.mapError(toWorkflowError),
				),
			});
			if (entitySchemaId) {
				entitySchemaIdsBySlug.set(entitySchemaSlug, entitySchemaId);
			}

			return entitySchemaId;
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

	const getEventSchemaId = (entitySchemaId: EntitySchemaId, eventSchemaSlug: string) =>
		Effect.gen(function* () {
			const schemaKey = `${entitySchemaId}:${eventSchemaSlug}`;
			const cached = eventSchemaIdsByKey.get(schemaKey);
			if (cached) {
				return cached;
			}

			const eventSchemaId = yield* Activity.make({
				error: ImportRunError,
				success: Schema.NullOr(EventSchemaId),
				name: `load-event-schema-${activityKey(schemaKey)}`,
				execute: runWithDb(
					eventSchemas.getBuiltinBySlug({ entitySchemaId, slug: eventSchemaSlug }),
				).pipe(
					Effect.map((found) => found?.id ?? null),
					Effect.mapError(toWorkflowError),
				),
			});
			if (eventSchemaId) {
				eventSchemaIdsByKey.set(schemaKey, eventSchemaId);
			}

			return eventSchemaId;
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
		let groupFailed = false;
		const entitySchemaId = yield* getEntitySchemaId(ref.entitySchemaSlug);
		if (!entitySchemaId) {
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

		for (
			let membershipIndex = 0;
			membershipIndex < group.collectionMemberships.length;
			membershipIndex += 1
		) {
			const membership = group.collectionMemberships[membershipIndex];
			if (!membership) {
				continue;
			}

			const collectionId = yield* getCollectionId(membership.collectionName).pipe(Effect.either);
			if (collectionId._tag === "Left") {
				groupFailed = true;
				yield* recordWriteFailure({
					ref,
					itemIndex,
					payload: input.payload,
					message: collectionId.left.message,
					name: `record-collection-lookup-failure-${i}-${membershipIndex}`,
				});
				continue;
			}
			const membershipResult = yield* Activity.make({
				success: EnsureLibraryMembershipOutcome,
				name: `add-collection-membership-${i}-${membershipIndex}`,
				execute: collections
					.addToCollection(user, { entityId, collectionId: collectionId.right, properties: {} })
					.pipe(
						Effect.as({ message: null }),
						Effect.catchAll((error) => Effect.succeed({ message: unknownToMessage(error) })),
					),
			});
			if (membershipResult.message) {
				groupFailed = true;
				yield* recordWriteFailure({
					ref,
					itemIndex,
					payload: input.payload,
					message: membershipResult.message,
					name: `record-collection-write-failure-${i}-${membershipIndex}`,
				});
			}
		}

		for (let eventIndex = 0; eventIndex < group.events.length; eventIndex += 1) {
			const event = group.events[eventIndex];
			if (!event) {
				continue;
			}
			let targetEntityId = entityId;
			let targetEntitySchemaId = entitySchemaId;
			let targetEntitySchemaSlug = ref.entitySchemaSlug;

			if (event.episodeLocator?.type === "show") {
				const resolvedEpisodeId = yield* Activity.make({
					error: ImportRunError,
					success: Schema.NullOr(EntityId),
					name: `resolve-show-episode-${i}-${eventIndex}`,
					execute: episodeResolver
						.resolveShowEpisode({
							showEntityId: entityId,
							userId: input.payload.userId,
							seasonNumber: event.episodeLocator.seasonNumber,
							episodeNumber: event.episodeLocator.episodeNumber,
						})
						.pipe(Effect.mapError(toWorkflowError)),
				});

				if (!resolvedEpisodeId) {
					groupFailed = true;
					yield* recordEpisodeResolutionFailure({
						i,
						ref,
						event,
						itemIndex,
						eventIndex,
						payload: input.payload,
					});
					continue;
				}

				const episodeEntitySchemaId = yield* getEntitySchemaId("show-episode");
				if (!episodeEntitySchemaId) {
					groupFailed = true;
					yield* recordEpisodeSchemaMissing({
						i,
						ref,
						itemIndex,
						eventIndex,
						payload: input.payload,
						entitySchemaSlug: "show-episode",
					});
					continue;
				}

				targetEntityId = resolvedEpisodeId;
				targetEntitySchemaId = episodeEntitySchemaId;
				targetEntitySchemaSlug = "show-episode";
			}

			if (event.episodeLocator?.type === "podcast") {
				const resolvedEpisodeId = yield* Activity.make({
					error: ImportRunError,
					success: Schema.NullOr(EntityId),
					name: `resolve-podcast-episode-${i}-${eventIndex}`,
					execute: episodeResolver
						.resolvePodcastEpisode({
							podcastEntityId: entityId,
							userId: input.payload.userId,
							episodeNumber: event.episodeLocator.episodeNumber,
						})
						.pipe(Effect.mapError(toWorkflowError)),
				});

				if (!resolvedEpisodeId) {
					groupFailed = true;
					yield* recordEpisodeResolutionFailure({
						i,
						ref,
						event,
						itemIndex,
						eventIndex,
						payload: input.payload,
					});
					continue;
				}

				const episodeEntitySchemaId = yield* getEntitySchemaId("podcast-episode");
				if (!episodeEntitySchemaId) {
					groupFailed = true;
					yield* recordEpisodeSchemaMissing({
						i,
						ref,
						itemIndex,
						eventIndex,
						payload: input.payload,
						entitySchemaSlug: "podcast-episode",
					});
					continue;
				}

				targetEntityId = resolvedEpisodeId;
				targetEntitySchemaSlug = "podcast-episode";
				targetEntitySchemaId = episodeEntitySchemaId;
			}

			const eventSchemaId = yield* getEventSchemaId(targetEntitySchemaId, event.eventSchemaSlug);
			if (!eventSchemaId) {
				groupFailed = true;
				yield* recordWriteFailure({
					ref,
					itemIndex,
					payload: input.payload,
					eventSchemaSlug: event.eventSchemaSlug,
					entitySchemaSlug: targetEntitySchemaSlug,
					name: `record-event-schema-missing-${i}-${eventIndex}`,
					message: `Event schema not found: ${event.eventSchemaSlug}`,
				});
				continue;
			}

			const eventPayload = [
				{
					eventSchemaId,
					entityId: targetEntityId,
					occurredAt: event.occurredAt,
					properties: event.properties,
				},
			];
			const eventExecutionId = `${input.executionId}-event-${i}-${eventIndex}`;
			const eventWrite = yield* events
				.create({
					payload: eventPayload,
					userId: input.payload.userId,
					executionId: eventExecutionId,
					source: input.options.integrationId ? "integration" : "import",
					metadata: {
						importRunId: input.payload.runId,
						...(input.options.integrationId ? { integrationId: input.options.integrationId } : {}),
					},
				})
				.pipe(
					Effect.as({ message: null as string | null }),
					Effect.catchAll((error) => Effect.succeed({ message: unknownToMessage(error) })),
				);
			if (eventWrite.message) {
				groupFailed = true;
				yield* recordWriteFailure({
					ref,
					itemIndex,
					payload: input.payload,
					message: eventWrite.message,
					eventSchemaSlug: event.eventSchemaSlug,
					entitySchemaSlug: targetEntitySchemaSlug,
					name: `record-event-write-failure-${i}-${eventIndex}`,
				});
			}
		}

		if (group.ownershipProvider) {
			const ownershipResult = yield* Activity.make({
				name: `mark-library-ownership-${i}`,
				success: EnsureLibraryMembershipOutcome,
				execute: collections
					.markEntityOwnedInLibrary({
						entityId,
						syncedAt: ownershipSyncedAt,
						userId: input.payload.userId,
						provider: group.ownershipProvider,
					})
					.pipe(
						Effect.as({ message: null }),
						Effect.catchAll((error) => Effect.succeed({ message: unknownToMessage(error) })),
					),
			});
			if (ownershipResult.message) {
				groupFailed = true;
				yield* recordWriteFailure({
					ref,
					itemIndex,
					payload: input.payload,
					message: ownershipResult.message,
					name: `record-ownership-write-failure-${i}`,
				});
			}
		}

		if (groupFailed) {
			failures += 1;
		} else {
			importedItems += 1;
		}

		yield* input.reportProgress(i + 1);
	}

	return { failures, importedItems };
});
