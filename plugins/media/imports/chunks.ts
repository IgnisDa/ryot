import type {
	GenericImportChunk,
	GenericImportFailure,
	GenericImportWriteItem,
} from "@ryot/sandbox-sdk/imports";

import type { MediaImportPopulationWorkflowOutput } from "../workflows/schemas";
import type {
	ImportMediaEntityGroup,
	MediaImportAdapterFailure,
	MediaImportEpisodeResolution,
} from "./schemas";

type PopulationResult = (typeof MediaImportPopulationWorkflowOutput.Type)["results"][number];

const failureSource = (
	group: ImportMediaEntityGroup,
	message: string,
	stage: GenericImportFailure["stage"],
): GenericImportFailure => ({
	message,
	stage,
	itemIndex: group.itemIndex,
	sourceLabel: group.entityRef.sourceLabel,
	entitySchemaSlug: group.entityRef.entitySchemaSlug,
	sourceIdentifier:
		group.entityRef.kind === "resolved"
			? group.entityRef.externalId
			: group.entityRef.identifierValue,
});

const adapterFailure = (failure: MediaImportAdapterFailure): GenericImportFailure => ({
	itemIndex: failure.itemIndex,
	message: failure.message,
	stage: failure.stage ?? "input_transformation",
	sourceLabel: failure.sourceLabel ?? `Item ${failure.itemIndex + 1}`,
	sourceIdentifier: failure.sourceIdentifier ?? String(failure.itemIndex),
});

export const createMediaImportChunk = (input: {
	readonly failures: ReadonlyArray<MediaImportAdapterFailure>;
	readonly entityGroups: ReadonlyArray<ImportMediaEntityGroup>;
	readonly populationResults: ReadonlyArray<PopulationResult>;
	readonly episodeResolutions: ReadonlyArray<MediaImportEpisodeResolution>;
}): GenericImportChunk => {
	const failures = input.failures.map(adapterFailure);
	const items: GenericImportWriteItem[] = [];
	const populationByIndex = new Map(
		input.populationResults.map((result) => [result.index, result]),
	);
	const episodeByIndex = new Map(
		input.episodeResolutions.map((result) => [
			`${result.groupIndex}:${result.eventIndex}`,
			result.entityId,
		]),
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
			failures.push(
				failureSource(
					group,
					population.message,
					population.stage === "membership" ? "database_commit" : "provider_details",
				),
			);
			continue;
		}

		const events: GenericImportWriteItem["events"][number][] = [];
		for (const [eventIndex, event] of group.events.entries()) {
			if (!event.episodeLocator) {
				events.push({
					entityAlias: "media",
					occurredAt: event.occurredAt,
					properties: event.properties,
					eventSchemaSlug: event.eventSchemaSlug,
				});
				continue;
			}
			const subjectEntityId = episodeByIndex.get(`${groupIndex}:${eventIndex}`);
			if (!subjectEntityId) {
				failures.push(
					failureSource(
						group,
						event.episodeLocator.type === "show"
							? `Could not resolve show episode S${event.episodeLocator.seasonNumber}E${event.episodeLocator.episodeNumber}`
							: `Could not resolve podcast episode ${event.episodeLocator.episodeNumber}`,
						"provider_resolution",
					),
				);
				continue;
			}
			events.push({
				entityAlias: "media",
				occurredAt: event.occurredAt,
				properties: event.properties,
				subjectEntityId,
				eventSchemaSlug: event.eventSchemaSlug,
			});
		}

		items.push({
			events,
			itemIndex: group.itemIndex,
			relationships: [],
			sourceLabel: group.entityRef.sourceLabel,
			sourceIdentifier:
				group.entityRef.kind === "resolved"
					? group.entityRef.externalId
					: group.entityRef.identifierValue,
			entities: [
				{
					alias: "media",
					name: group.entityRef.sourceLabel,
					entityId: population.entityId,
					properties: {},
					entitySchemaSlug: group.entityRef.entitySchemaSlug,
				},
			],
			...(group.ownershipProvider
				? { ownerships: [{ entityAlias: "media", provider: group.ownershipProvider }] }
				: {}),
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

	return { failures, items };
};
