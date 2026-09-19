import type {
	GenericImportChunk,
	GenericImportFailure,
	GenericImportWriteItem,
} from "@ryot-app/sandbox-sdk/imports";

import { importEntityRefIdentifier } from "./groups";
import type {
	ImportMediaEntityGroup,
	MediaImportAdapterFailure,
	MediaImportWriteChunkInput,
} from "./schemas";

const failureSource = (
	group: Pick<ImportMediaEntityGroup, "entityRef" | "itemIndex">,
	message: string,
	stage: GenericImportFailure["stage"],
): GenericImportFailure => ({
	stage,
	message,
	unit: "records",
	recordKind: "media",
	itemIndex: group.itemIndex,
	sourceLabel: group.entityRef.sourceLabel,
	entitySchemaSlug: group.entityRef.entitySchemaSlug,
	sourceIdentifier: importEntityRefIdentifier(group.entityRef),
});

const adapterFailure = (failure: MediaImportAdapterFailure): GenericImportFailure => ({
	message: failure.message,
	itemIndex: failure.itemIndex,
	unit: failure.unit ?? "records",
	recordKind: failure.recordKind ?? "media",
	stage: failure.stage ?? "input_transformation",
	sourceLabel: failure.sourceLabel ?? `Item ${failure.itemIndex + 1}`,
	sourceIdentifier: failure.sourceIdentifier ?? String(failure.itemIndex),
	...(failure.entitySchemaSlug === undefined ? {} : { entitySchemaSlug: failure.entitySchemaSlug }),
});

export const createMediaImportChunk = (
	input: MediaImportWriteChunkInput,
	ownershipSyncedAt: string,
): GenericImportChunk => {
	const failures = input.failures.map(adapterFailure);
	const items: GenericImportWriteItem[] = [];
	const populationByIndex = new Map(
		input.populationResults.map((result) => [result.index, result]),
	);

	for (const [groupIndex, group] of input.entityGroups.entries()) {
		const population = populationByIndex.get(groupIndex);
		if (!population || population.status === "failed") {
			const message = population?.message ?? "Media entity could not be resolved";
			const stage = population ? "provider_details" : "provider_resolution";
			if (!group.events.length) {
				failures.push(failureSource(group, message, stage));
			}
			for (const event of group.events) {
				failures.push({
					...failureSource(group, message, stage),
					unit: "events",
					recordKind: event.eventSchemaSlug,
					itemIndex: event.sourceItemIndex ?? group.itemIndex,
					sourceLabel: event.attribution?.sourceLabel ?? group.entityRef.sourceLabel,
					sourceIdentifier:
						event.attribution?.sourceIdentifier ?? importEntityRefIdentifier(group.entityRef),
				});
			}
			continue;
		}

		items.push({
			itemIndex: group.itemIndex,
			subjectEntityAlias: "media",
			sourceLabel: group.entityRef.sourceLabel,
			recordId: JSON.stringify(["media", group.itemIndex]),
			sourceIdentifier: importEntityRefIdentifier(group.entityRef),
			relationships: [
				{
					sourceAlias: "media",
					propertiesMode: "merge",
					targetAlias: "media-library",
					relationshipSchemaSlug: "in-media-library",
					operationId: JSON.stringify(["media", group.itemIndex, "library-membership"]),
					properties: group.ownershipProvider
						? { owned: true, ownershipSyncedAt, ownershipSources: [group.ownershipProvider] }
						: {},
				},
			],
			entities: [
				{
					alias: "media",
					properties: {},
					entityId: population.entityId,
					name: group.entityRef.sourceLabel,
					entitySchemaSlug: group.entityRef.entitySchemaSlug,
					operationId: JSON.stringify(["media", group.itemIndex, "entity"]),
				},
				{
					scope: "user",
					properties: {},
					existingOnly: true,
					name: "Media Library",
					alias: "media-library",
					entitySchemaSlug: "media-library",
					match: { properties: {}, name: "Media Library" },
					operationId: JSON.stringify(["media", group.itemIndex, "library"]),
				},
			],
			events: group.events.map((event, eventIndex) => ({
				entityAlias: "media",
				occurredAt: event.occurredAt,
				properties: event.properties,
				eventSchemaSlug: event.eventSchemaSlug,
				outcome: { unit: "events", recordKind: event.eventSchemaSlug },
				operationId:
					event.operationId ?? JSON.stringify(["media", group.itemIndex, "event", eventIndex]),
				attribution: event.attribution ?? {
					sourceLabel: group.entityRef.sourceLabel,
					recordId: JSON.stringify(["media-source", group.itemIndex]),
					sourceIdentifier: importEntityRefIdentifier(group.entityRef),
				},
				...(event.subjectEntityId === undefined ? {} : { subjectEntityId: event.subjectEntityId }),
			})),
			...(group.collectionMemberships.length > 0
				? {
						collectionMemberships: group.collectionMemberships.map(({ collectionName }) => ({
							collectionName,
							entityAlias: "media",
							operationId: JSON.stringify(["media", group.itemIndex, "collection", collectionName]),
						})),
					}
				: {}),
		});
	}

	return { items, failures };
};
