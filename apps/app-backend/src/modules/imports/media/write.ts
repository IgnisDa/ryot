import { Effect, Either } from "effect";

import type { CurrentUserValue } from "~/lib/auth";
import { DbRunner } from "~/lib/db";
import type { DbError } from "~/lib/errors";
import { CollectionsService } from "~/modules/collections/service";
import { EntitySchemasRepository } from "~/modules/entity-schemas/repository";
import { EventSchemasRepository } from "~/modules/event-schemas/repository";
import { EventsService } from "~/modules/events/service";

import { recordImportRunFailure } from "../runtime/failures";
import { mediaEntityGroupItemIndex } from "./groups";
import { type ImportMediaEntityGroup, importEntityRefKey } from "./types";

export const writeMediaEntityGroups = (input: {
	runId: string;
	userId: string;
	entityGroups: ImportMediaEntityGroup[];
	entityIdsByKey: ReadonlyMap<string, string>;
	onProgress: (processed: number) => Effect.Effect<void, DbError>;
	eventContext?: { origin: "import" | "integration"; integrationId?: string };
}) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const events = yield* EventsService;
		const collections = yield* CollectionsService;
		const eventSchemas = yield* EventSchemasRepository;
		const entitySchemas = yield* EntitySchemasRepository;

		const schemaIdCache = new Map<string, string>();
		const collectionIdCache = new Map<string, string>();
		const eventSchemaCache = new Map<string, { id: string }>();
		const user: CurrentUserValue = { id: input.userId, name: "", email: "" };

		let writeFailures = 0;
		let importedItems = 0;

		for (let i = 0; i < input.entityGroups.length; i++) {
			const group = input.entityGroups[i];
			const ref = group?.entityRef;
			if (!group || ref?.kind !== "resolved") {
				yield* input.onProgress(i + 1);
				continue;
			}

			const entityId = input.entityIdsByKey.get(importEntityRefKey(ref));
			if (!entityId) {
				yield* input.onProgress(i + 1);
				continue;
			}

			const itemIndex = mediaEntityGroupItemIndex(group, i);
			let groupFailed = false;

			let entitySchemaId = schemaIdCache.get(ref.entitySchemaSlug);
			if (!entitySchemaId) {
				const entitySchema = yield* runWithDb(entitySchemas.getBuiltinBySlug(ref.entitySchemaSlug));
				if (!entitySchema) {
					writeFailures++;
					yield* recordImportRunFailure({
						itemIndex,
						context: null,
						runId: input.runId,
						stage: "database_commit",
						sourceLabel: ref.sourceLabel,
						sourceIdentifier: ref.externalId,
						entitySchemaSlug: ref.entitySchemaSlug,
						message: `Entity schema not found: ${ref.entitySchemaSlug}`,
					});
					yield* input.onProgress(i + 1);
					continue;
				}
				entitySchemaId = entitySchema.id;
				schemaIdCache.set(ref.entitySchemaSlug, entitySchemaId);
			}

			for (const membership of group.collectionMemberships) {
				let collectionId = collectionIdCache.get(membership.collectionName);
				if (!collectionId) {
					const collection = yield* collections
						.getOrCreateCollection(input.userId, membership.collectionName)
						.pipe(Effect.either);
					if (Either.isLeft(collection)) {
						groupFailed = true;
						yield* recordImportRunFailure({
							itemIndex,
							context: null,
							runId: input.runId,
							stage: "database_commit",
							sourceLabel: ref.sourceLabel,
							sourceIdentifier: ref.externalId,
							message: collection.left.message,
							entitySchemaSlug: ref.entitySchemaSlug,
						});
						continue;
					}
					collectionId = collection.right.id;
					collectionIdCache.set(membership.collectionName, collectionId);
				}

				const added = yield* collections
					.addToCollection(user, { entityId, collectionId, properties: {} })
					.pipe(Effect.either);
				if (Either.isLeft(added)) {
					groupFailed = true;
					yield* recordImportRunFailure({
						itemIndex,
						context: null,
						runId: input.runId,
						stage: "database_commit",
						sourceLabel: ref.sourceLabel,
						message: added.left.message,
						sourceIdentifier: ref.externalId,
						entitySchemaSlug: ref.entitySchemaSlug,
					});
				}
			}

			for (const ev of group.events) {
				const schemaKey = `${entitySchemaId}:${ev.eventSchemaSlug}`;
				let eventSchema = eventSchemaCache.get(schemaKey);
				if (!eventSchema) {
					const found = yield* runWithDb(
						eventSchemas.getBuiltinBySlug({ entitySchemaId, slug: ev.eventSchemaSlug }),
					);
					if (!found) {
						groupFailed = true;
						yield* recordImportRunFailure({
							itemIndex,
							context: null,
							runId: input.runId,
							stage: "database_commit",
							sourceLabel: ref.sourceLabel,
							sourceIdentifier: ref.externalId,
							eventSchemaSlug: ev.eventSchemaSlug,
							entitySchemaSlug: ref.entitySchemaSlug,
							message: `Event schema not found: ${ev.eventSchemaSlug}`,
						});
						continue;
					}
					eventSchema = found;
					eventSchemaCache.set(schemaKey, eventSchema);
				}

				const eventPayload = [
					{
						entityId,
						occurredAt: ev.occurredAt,
						properties: ev.properties,
						eventSchemaId: eventSchema.id,
					},
				];
				const created = yield* (
					input.eventContext?.origin === "integration" && input.eventContext.integrationId
						? events.createForIntegration({
								userId: input.userId,
								payload: eventPayload,
								importRunId: input.runId,
								integrationId: input.eventContext.integrationId,
							})
						: events.createForImport(input.userId, eventPayload, input.runId)
				).pipe(Effect.either);
				if (Either.isLeft(created)) {
					groupFailed = true;
					yield* recordImportRunFailure({
						itemIndex,
						context: null,
						runId: input.runId,
						stage: "database_commit",
						sourceLabel: ref.sourceLabel,
						message: created.left.message,
						sourceIdentifier: ref.externalId,
						eventSchemaSlug: ev.eventSchemaSlug,
						entitySchemaSlug: ref.entitySchemaSlug,
					});
				}
			}

			if (groupFailed) {
				writeFailures++;
			} else {
				importedItems++;
			}

			yield* input.onProgress(i + 1);
		}

		return { writeFailures, importedItems };
	});
