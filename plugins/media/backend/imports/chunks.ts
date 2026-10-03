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
	itemIndex: group.itemIndex,
	sourceLabel: group.entityRef.sourceLabel,
	entitySchemaSlug: group.entityRef.entitySchemaSlug,
	sourceIdentifier: importEntityRefIdentifier(group.entityRef),
});

const adapterFailure = (failure: MediaImportAdapterFailure): GenericImportFailure => ({
	message: failure.message,
	itemIndex: failure.itemIndex,
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
		if (!population) {
			failures.push(
				failureSource(group, "Media entity could not be resolved", "provider_resolution"),
			);
			continue;
		}
		if (population.status === "failed") {
			failures.push(failureSource(group, population.message, "provider_details"));
			continue;
		}

		items.push({
			itemIndex: group.itemIndex,
			subjectEntityAlias: "media",
			sourceLabel: group.entityRef.sourceLabel,
			sourceIdentifier: importEntityRefIdentifier(group.entityRef),
			events: group.events.map((event) => ({
				entityAlias: "media",
				occurredAt: event.occurredAt,
				properties: event.properties,
				eventSchemaSlug: event.eventSchemaSlug,
				...(event.subjectEntityId === undefined ? {} : { subjectEntityId: event.subjectEntityId }),
			})),
			relationships: [
				{
					sourceAlias: "media",
					propertiesMode: "merge",
					targetAlias: "media-library",
					relationshipSchemaSlug: "in-media-library",
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
				},
				{
					scope: "user",
					properties: {},
					existingOnly: true,
					name: "Media Library",
					alias: "media-library",
					entitySchemaSlug: "media-library",
					match: { properties: {}, name: "Media Library" },
				},
			],
			...(group.collectionMemberships.length > 0
				? {
						collectionMemberships: group.collectionMemberships.map(({ collectionName }) => ({
							collectionName,
							entityAlias: "media",
						})),
					}
				: {}),
		});
	}

	return { items, failures };
};
