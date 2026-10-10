import type {
	GenericImportChunk,
	GenericImportFailure,
	GenericImportWriteItem,
} from "@ryot-app/sandbox-sdk/imports";

import { importEntityRefIdentifier } from "./groups";
import {
	mediaCollectionOperationId,
	mediaEntityOperationId,
	mediaLibraryMembershipOperationId,
	mediaLibraryOperationId,
	mediaRecordId,
	mediaSourceRecordId,
} from "./identity";
import type {
	ImportMediaEntityGroup,
	MediaImportFailure,
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
	operationId: mediaEntityOperationId(group.itemIndex),
	sourceIdentifier: importEntityRefIdentifier(group.entityRef),
});

const adapterFailure = (failure: MediaImportFailure): GenericImportFailure => ({
	message: failure.message,
	itemIndex: failure.itemIndex,
	unit: failure.unit ?? "records",
	operationId: failure.operationId,
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
					operationId: event.operationId,
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
			recordId: mediaRecordId(group.itemIndex),
			sourceIdentifier: importEntityRefIdentifier(group.entityRef),
			relationships: [
				{
					sourceAlias: "media",
					propertiesMode: "merge",
					targetAlias: "media-library",
					relationshipSchemaSlug: "in-media-library",
					operationId: mediaLibraryMembershipOperationId(group.itemIndex),
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
					operationId: mediaEntityOperationId(group.itemIndex),
				},
				{
					scope: "user",
					properties: {},
					existingOnly: true,
					name: "Media Library",
					alias: "media-library",
					entitySchemaSlug: "media-library",
					match: { properties: {}, name: "Media Library" },
					operationId: mediaLibraryOperationId(group.itemIndex),
				},
			],
			events: group.events.map((event) => ({
				entityAlias: "media",
				occurredAt: event.occurredAt,
				properties: event.properties,
				operationId: event.operationId,
				eventSchemaSlug: event.eventSchemaSlug,
				outcome: { unit: "events", recordKind: event.eventSchemaSlug },
				attribution: event.attribution ?? {
					sourceLabel: group.entityRef.sourceLabel,
					recordId: mediaSourceRecordId(group.itemIndex),
					sourceIdentifier: importEntityRefIdentifier(group.entityRef),
				},
				...(event.subjectEntityId === undefined ? {} : { subjectEntityId: event.subjectEntityId }),
			})),
			...(group.collectionMemberships.length > 0
				? {
						collectionMemberships: group.collectionMemberships.map(({ collectionName }) => ({
							collectionName,
							entityAlias: "media",
							operationId: mediaCollectionOperationId(group.itemIndex, collectionName),
						})),
					}
				: {}),
		});
	}

	return { items, failures };
};
