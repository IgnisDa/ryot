import type { LifecycleCommand, ingestionArtifactsSchema } from "@ryot-app/sandbox-sdk/imports";
import {
	defineScriptReference,
	defineWorkflowReference,
	Effect,
	Schema,
	type WorkflowReplay,
} from "@ryot-app/sandbox-sdk/workflow";

import { ResolveEpisodesInput, ResolveEpisodesOutput } from "../contracts/operations";
import {
	MediaImportPopulationWorkflowInput,
	MediaImportPopulationWorkflowOutput,
	MediaImportResolutionWorkflowInput,
	MediaImportResolutionWorkflowOutput,
} from "../contracts/workflows";
import { importEntityRefIdentifier } from "./groups";
import type {
	MediaImportFailure,
	UnresolvedEpisodeRef,
	MediaImportAdapterBatch,
	MediaImportWriteChunkInput,
} from "./schemas";
import {
	MediaImportWriteChunkActivityInput,
	NetflixResolutionInput,
	NetflixResolutionOutput,
} from "./schemas";

export class MediaWorkflowError extends Error {
	readonly _tag = "MediaWorkflowError";
}

const mediaImportResolutionActivitySlugByProvider = {
	"show.tmdb": "media-import-resolve.show.tmdb",
	"movie.tmdb": "media-import-resolve.movie.tmdb",
	"book.hardcover": "media-import-resolve.book.hardcover",
	"book.openlibrary": "media-import-resolve.book.openlibrary",
	"book.google-books": "media-import-resolve.book.google-books",
} as const;

type FinalizedEntityGroup = MediaImportWriteChunkInput["entityGroups"][number];
type FinalizedEvent = FinalizedEntityGroup["events"][number];

const unresolvedEpisodeMessage = (episode: UnresolvedEpisodeRef) => {
	if (episode.type === "show-season") {
		return `Could not resolve show season ${episode.seasonNumber}`;
	}
	return episode.type === "show"
		? `Could not resolve show episode S${episode.seasonNumber}E${episode.episodeNumber}`
		: `Could not resolve podcast episode ${episode.episodeNumber}`;
};

const resolution = defineWorkflowReference({
	workflowSlug: "media-import-resolution",
	input: MediaImportResolutionWorkflowInput,
	output: MediaImportResolutionWorkflowOutput,
});

const population = defineWorkflowReference({
	workflowSlug: "media-import-population",
	input: MediaImportPopulationWorkflowInput,
	output: MediaImportPopulationWorkflowOutput,
});

const episodes = defineScriptReference({
	input: ResolveEpisodesInput,
	output: ResolveEpisodesOutput,
	scriptSlug: "import.resolve-episodes",
});

const chunkWriter = defineScriptReference({
	scriptSlug: "import.write-chunks",
	input: MediaImportWriteChunkActivityInput,
	output: Schema.Struct({ chunkHandles: Schema.Array(Schema.String) }),
});

const resolutionCandidates = (entitySchemaSlug: string) =>
	Object.entries(mediaImportResolutionActivitySlugByProvider).flatMap(
		([providerSlug, scriptSlug]) =>
			providerSlug.startsWith(`${entitySchemaSlug}.`) ? [{ scriptSlug, providerSlug }] : [],
	);

const netflixResolution = defineScriptReference({
	input: NetflixResolutionInput,
	output: NetflixResolutionOutput,
	scriptSlug: "import.netflix-resolution",
});

type BatchStep =
	| ReturnType<WorkflowReplay["child"]>
	| ReturnType<typeof Effect.fail<MediaWorkflowError>>;

export function* runMediaImportBatch(
	replay: WorkflowReplay,
	input: {
		runId: string;
		batchIndex: number;
		integrationId?: string;
		command: LifecycleCommand;
		batch: typeof MediaImportAdapterBatch.Type;
		ingestionArtifacts?: typeof ingestionArtifactsSchema.Type;
	},
): Generator<BatchStep, { readonly chunkHandles: readonly string[] }, unknown> {
	const { batch, batchIndex, integrationId } = input;
	const netflixItems = batch.entityGroups.flatMap((group, index) =>
		group.entityRef.kind === "unresolved" && group.entityRef.identifierType === "netflix-title"
			? [
					{
						index,
						title: group.entityRef.identifierValue,
						entitySchemaSlug: group.entityRef.entitySchemaSlug,
					},
				]
			: [],
	);
	const netflixOutput = netflixItems.length
		? yield* replay.activity(`netflix-resolution-${batchIndex}`, netflixResolution, {
				items: netflixItems,
			})
		: { results: [] };
	const netflixByIndex = new Map(
		netflixOutput.results.map((result) => [result.index, result.entityRef]),
	);
	const netflixFailures: MediaImportFailure[] = [];
	const resolutionItems = batch.entityGroups.flatMap((group, index) =>
		group.entityRef.kind === "unresolved" && group.entityRef.identifierType !== "netflix-title"
			? [
					{
						index,
						value: group.entityRef.identifierValue,
						identifierType: group.entityRef.identifierType,
						candidates: resolutionCandidates(group.entityRef.entitySchemaSlug),
					},
				]
			: [],
	);
	const resolutionOutput =
		resolutionItems.length > 0
			? yield* replay.child(`resolve-${batchIndex}`, resolution, { items: resolutionItems })
			: { results: [] };
	const resolutionByIndex = new Map(
		resolutionOutput.results.map((result) => [result.index, result]),
	);
	const resolvedGroups = batch.entityGroups
		.map((group, index) => {
			const netflix = netflixByIndex.get(index);
			if (netflix) {
				const events = group.events.filter((event) => {
					if (netflix.entitySchemaSlug !== "show" || event.eventSchemaSlug !== "complete") {
						return true;
					}
					netflixFailures.push({
						unit: "events",
						recordKind: "complete",
						stage: "provider_resolution",
						operationId: event.operationId,
						itemIndex: event.sourceItemIndex ?? group.itemIndex,
						sourceLabel: event.attribution?.sourceLabel ?? group.entityRef.sourceLabel,
						message: "Viewing activity matched a show but no season or episode could be extracted",
						sourceIdentifier:
							event.attribution?.sourceIdentifier ?? importEntityRefIdentifier(group.entityRef),
					});
					return false;
				});
				return events.length || group.collectionMemberships.length
					? { ...group, events, entityRef: netflix }
					: null;
			}
			if (group.entityRef.kind === "resolved") {
				return group;
			}
			const result = resolutionByIndex.get(index);
			return result?.status === "resolved"
				? {
						...group,
						entityRef: {
							kind: "resolved" as const,
							externalId: result.externalId,
							providerSlug: result.providerSlug,
							sourceLabel: group.entityRef.sourceLabel,
							entitySchemaSlug: group.entityRef.entitySchemaSlug,
						},
					}
				: group;
		})
		.flatMap((group) => (group ? [group] : []));
	const populationItems = resolvedGroups.flatMap((group, index) =>
		group.entityRef.kind === "resolved"
			? [
					{
						index,
						externalId: group.entityRef.externalId,
						providerSlug: group.entityRef.providerSlug,
						entitySchemaSlug: group.entityRef.entitySchemaSlug,
						command: {
							...input.command,
							itemIdentity: JSON.stringify([
								input.command.itemIdentity,
								"population",
								group.itemIndex,
							]),
						},
					},
				]
			: [],
	);
	const populationOutput =
		populationItems.length > 0
			? yield* replay.child(`populate-${batchIndex}`, population, { items: populationItems })
			: { results: [] };
	const populationByIndex = new Map(
		populationOutput.results.map((result) => [result.index, result]),
	);
	const episodeRequests = resolvedGroups.flatMap((group, groupIndex) => {
		const populated = populationByIndex.get(groupIndex);
		if (populated?.status !== "completed") {
			return [];
		}
		return group.events.flatMap((event, eventIndex) =>
			event.unresolvedEpisode
				? [
						{
							eventIndex,
							groupIndex,
							parentEntityId: populated.entityId,
							unresolvedEpisode: event.unresolvedEpisode,
						},
					]
				: [],
		);
	});
	const episodeRefs = episodeRequests.map(({ parentEntityId, unresolvedEpisode }, index) => {
		if (unresolvedEpisode.type === "show-season") {
			return {
				index,
				kind: "show-season" as const,
				showEntityId: parentEntityId,
				seasonNumber: unresolvedEpisode.seasonNumber,
			};
		}
		return unresolvedEpisode.type === "show"
			? {
					index,
					kind: "show" as const,
					showEntityId: parentEntityId,
					seasonNumber: unresolvedEpisode.seasonNumber,
					episodeNumber: unresolvedEpisode.episodeNumber,
				}
			: {
					index,
					kind: "podcast" as const,
					podcastEntityId: parentEntityId,
					episodeNumber: unresolvedEpisode.episodeNumber,
				};
	});
	const episodeOutput =
		episodeRefs.length > 0
			? yield* replay.activity(`episodes-${batchIndex}`, episodes, { refs: episodeRefs })
			: { results: [] };
	const answeredRequests = new Set<number>();
	const episodeEntityIdByEvent = new Map<string, string | null>();
	for (const result of episodeOutput.results) {
		const request = episodeRequests[result.index];
		if (!request) {
			return yield* Effect.fail(
				new MediaWorkflowError(`Episode resolution returned an unexpected index ${result.index}`),
			);
		}
		if (answeredRequests.has(result.index)) {
			return yield* Effect.fail(
				new MediaWorkflowError(`Episode resolution returned a duplicate index ${result.index}`),
			);
		}
		answeredRequests.add(result.index);
		episodeEntityIdByEvent.set(`${request.groupIndex}:${request.eventIndex}`, result.entityId);
	}
	const unansweredRequests = episodeRequests.flatMap((_, index) =>
		answeredRequests.has(index) ? [] : [index],
	);
	if (unansweredRequests.length > 0) {
		return yield* Effect.fail(
			new MediaWorkflowError(`Episode resolution omitted indices ${unansweredRequests.join(", ")}`),
		);
	}
	const episodeFailures: MediaImportFailure[] = [];
	const finalizedGroups: FinalizedEntityGroup[] = [];
	for (const [groupIndex, group] of resolvedGroups.entries()) {
		const events: FinalizedEvent[] = [];
		for (const [eventIndex, event] of group.events.entries()) {
			const finalized = {
				occurredAt: event.occurredAt,
				properties: event.properties,
				attribution: event.attribution,
				operationId: event.operationId,
				sourceItemIndex: event.sourceItemIndex,
				eventSchemaSlug: event.eventSchemaSlug,
			};
			if (!event.unresolvedEpisode) {
				events.push(finalized);
				continue;
			}
			const eventKey = `${groupIndex}:${eventIndex}`;
			if (!episodeEntityIdByEvent.has(eventKey)) {
				continue;
			}
			const subjectEntityId = episodeEntityIdByEvent.get(eventKey);
			if (!subjectEntityId) {
				episodeFailures.push({
					unit: "events",
					stage: "provider_resolution",
					operationId: event.operationId,
					recordKind: event.eventSchemaSlug,
					entitySchemaSlug: group.entityRef.entitySchemaSlug,
					itemIndex: event.sourceItemIndex ?? group.itemIndex,
					message: unresolvedEpisodeMessage(event.unresolvedEpisode),
					sourceLabel: event.attribution?.sourceLabel ?? group.entityRef.sourceLabel,
					sourceIdentifier:
						event.attribution?.sourceIdentifier ?? importEntityRefIdentifier(group.entityRef),
				});
				continue;
			}
			events.push({
				...finalized,
				subjectEntityId,
				subjectEntitySchemaSlug: {
					show: "show-episode",
					podcast: "podcast-episode",
					"show-season": "show-season",
				}[event.unresolvedEpisode.type],
			});
		}
		finalizedGroups.push({ ...group, events });
	}
	const chunk = yield* replay.activity(`chunks-${batchIndex}`, chunkWriter, {
		ownershipSyncedAt: input.command.occurredAt,
		...(input.ingestionArtifacts ? { ingestionArtifacts: input.ingestionArtifacts } : {}),
		...(integrationId === undefined
			? {}
			: { integration: { integrationId, importRunId: input.runId } }),
		entityGroups: finalizedGroups,
		populationResults: populationOutput.results,
		failures: [...batch.failures, ...netflixFailures, ...episodeFailures],
	});
	return chunk;
}
