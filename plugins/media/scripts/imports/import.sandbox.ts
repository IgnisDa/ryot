import {
	genericImportAdapterManifestSchema,
	genericImportKernelInputSchema,
	genericImportWorkflowInputSchema,
	genericImportWorkflowResultSchema,
} from "@ryot/sandbox-sdk/imports";
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot/sandbox-sdk/workflow";

import { importEntityRefIdentifier } from "../../imports/groups";
import type { MediaImportAdapterFailure, UnresolvedEpisodeRef } from "../../imports/schemas";
import {
	MediaImportAdapterBatch,
	MediaImportDispatchParserInput,
	MediaIntegrationAdapterResult,
	MediaImportWriteChunkInput,
} from "../../imports/schemas";
import { ResolveEpisodesInput, ResolveEpisodesOutput } from "../../operations/schemas";
import {
	MediaImportPopulationWorkflowInput,
	MediaImportPopulationWorkflowOutput,
	MediaImportResolutionWorkflowInput,
	MediaImportResolutionWorkflowOutput,
} from "../../workflows/schemas";

export const manifest = defineManifest({
	kind: "workflow",
	capabilities: [],
	name: "Media import",
	slug: "workflow.media-import",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

const BATCH_SIZE = 25;

const mediaImportResolutionActivitySlugByProvider = {
	"book.google-books": "activity.media-import-resolve.book.google-books",
	"book.hardcover": "activity.media-import-resolve.book.hardcover",
	"book.openlibrary": "activity.media-import-resolve.book.openlibrary",
	"movie.tmdb": "activity.media-import-resolve.movie.tmdb",
	"show.tmdb": "activity.media-import-resolve.show.tmdb",
} as const;

export const mediaImportParser = (source: string) => ({
	input: MediaImportDispatchParserInput,
	output: MediaImportAdapterBatch,
	scriptSlug: `activity.import.${source}`,
});

const integrationAdapter = (scriptSlug: string) => ({
	input: Schema.Unknown,
	output: MediaIntegrationAdapterResult,
	scriptSlug,
});

type FinalizedEntityGroup = (typeof MediaImportWriteChunkInput.Type)["entityGroups"][number];
type FinalizedEvent = FinalizedEntityGroup["events"][number];

const unresolvedEpisodeMessage = (episode: UnresolvedEpisodeRef) =>
	episode.type === "show"
		? `Could not resolve show episode S${episode.seasonNumber}E${episode.episodeNumber}`
		: `Could not resolve podcast episode ${episode.episodeNumber}`;

const resolution = {
	input: MediaImportResolutionWorkflowInput,
	output: MediaImportResolutionWorkflowOutput,
	workflowSlug: "media-import-resolution",
};

const population = {
	input: MediaImportPopulationWorkflowInput,
	output: MediaImportPopulationWorkflowOutput,
	workflowSlug: "media-import-population",
};

const episodes = {
	input: ResolveEpisodesInput,
	output: ResolveEpisodesOutput,
	scriptSlug: "activity.import.resolve-episodes",
};

const chunkWriter = {
	input: MediaImportWriteChunkInput,
	output: genericImportAdapterManifestSchema,
	scriptSlug: "activity.import.write-chunks",
};

const kernelImport = {
	input: genericImportKernelInputSchema,
	output: genericImportWorkflowResultSchema,
	workflowSlug: "kernel:process-import-chunks",
};

const resolutionCandidates = (entitySchemaSlug: string) =>
	Object.entries(mediaImportResolutionActivitySlugByProvider).flatMap(
		([providerSlug, scriptSlug]) =>
			providerSlug.startsWith(`${entitySchemaSlug}.`) ? [{ providerSlug, scriptSlug }] : [],
	);

export default defineWorkflow({
	manifest,
	input: genericImportWorkflowInputSchema,
	output: genericImportWorkflowResultSchema,
	run: (input, replay) =>
		Effect.gen(function* () {
			const integrationId = input.sourcePayload?.["integrationId"];
			const integrationScriptSlug = input.sourcePayload?.["integrationScriptSlug"];
			const isIntegration =
				typeof integrationId === "string" && typeof integrationScriptSlug === "string";
			let parserInput: {
				start: number;
				limit: number;
				apiKey?: string;
				apiUrl?: string;
				collection?: string;
				password?: string;
				profileName?: string;
				username?: string;
				hasAnimeFile?: boolean;
				hasMangaFile?: boolean;
				allowInsecureConnections?: boolean;
			} = {
				start: 0,
				limit: BATCH_SIZE,
			};
			if (input.source === "igdb") {
				const collection = input.sourcePayload?.["collection"];
				if (typeof collection !== "string" || !collection.trim()) {
					throw new Error("Import job is missing IGDB collection");
				}
				parserInput = { ...parserInput, collection: collection.trim() };
			}
			if (input.source === "netflix") {
				const profileName = input.sourcePayload?.["profileName"];
				if (typeof profileName === "string") {
					parserInput = { ...parserInput, profileName };
				}
			}
			if (input.source === "myanimelist") {
				const hasAnimeFile = typeof input.sourcePayload?.["animeFilePath"] === "string";
				const hasMangaFile = typeof input.sourcePayload?.["mangaFilePath"] === "string";
				if (!hasAnimeFile && !hasMangaFile) {
					throw new Error("Import job is missing MyAnimeList export files");
				}
				parserInput = { ...parserInput, hasAnimeFile, hasMangaFile };
			}
			if (input.source === "trakt") {
				const username = input.sourcePayload?.["username"];
				if (typeof username !== "string" || !username.trim()) {
					throw new Error("Import job is missing Trakt username");
				}
				parserInput = { ...parserInput, username: username.trim() };
			}
			if (["plex", "audiobookshelf", "media_tracker"].includes(input.source)) {
				const apiKey = input.sourcePayload?.["apiKey"];
				const apiUrl = input.sourcePayload?.["apiUrl"];
				if (typeof apiKey !== "string" || !apiKey || typeof apiUrl !== "string" || !apiUrl) {
					throw new Error(`Import job is missing ${input.source} credentials`);
				}
				parserInput = {
					...parserInput,
					apiKey,
					apiUrl,
					...(typeof input.sourcePayload["allowInsecureConnections"] === "boolean"
						? { allowInsecureConnections: input.sourcePayload["allowInsecureConnections"] }
						: {}),
				};
			}
			if (input.source === "jellyfin") {
				const apiUrl = input.sourcePayload?.["apiUrl"];
				const username = input.sourcePayload?.["username"];
				if (typeof apiUrl !== "string" || !apiUrl || typeof username !== "string" || !username) {
					throw new Error("Import job is missing Jellyfin connection details");
				}
				parserInput = {
					...parserInput,
					apiUrl,
					username,
					...(typeof input.sourcePayload["password"] === "string"
						? { password: input.sourcePayload["password"] }
						: {}),
					...(typeof input.sourcePayload["allowInsecureConnections"] === "boolean"
						? { allowInsecureConnections: input.sourcePayload["allowInsecureConnections"] }
						: {}),
				};
			}
			const chunkFiles: string[] = [];
			let totalItems = 0;
			let failureCount = 0;
			let writeItemCount = 0;
			let start = 0;

			for (;;) {
				const batchIndex = start / BATCH_SIZE;
				let batch: typeof MediaImportAdapterBatch.Type;
				if (typeof integrationScriptSlug === "string" && typeof integrationId === "string") {
					const result = yield* replay.activity(
						"integration-adapter",
						integrationAdapter(integrationScriptSlug),
						input.sourcePayload?.["integrationContext"] ?? {},
					);
					batch = {
						...result,
						totalItems: result.failures.length + result.entityGroups.length,
					};
				} else {
					batch = yield* replay.activity(`parse-${batchIndex}`, mediaImportParser(input.source), {
						...parserInput,
						start,
					});
				}
				const resolutionItems = batch.entityGroups.flatMap((group, index) =>
					group.entityRef.kind === "unresolved"
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
						? yield* replay.child(`resolve-${batchIndex}`, resolution, {
								items: resolutionItems,
							})
						: { results: [] };
				const resolutionByIndex = new Map(
					resolutionOutput.results.map((result) => [result.index, result]),
				);
				const resolvedGroups = batch.entityGroups.map((group, index) => {
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
				});
				const populationItems = resolvedGroups.flatMap((group, index) =>
					group.entityRef.kind === "resolved"
						? [
								{
									index,
									externalId: group.entityRef.externalId,
									providerSlug: group.entityRef.providerSlug,
									entitySchemaSlug: group.entityRef.entitySchemaSlug,
									origin: isIntegration
										? { kind: "integration" as const, integrationId, importRunId: input.runId }
										: { kind: "import" as const, importRunId: input.runId },
								},
							]
						: [],
				);
				const populationOutput =
					populationItems.length > 0
						? yield* replay.child(`populate-${batchIndex}`, population, {
								items: populationItems,
							})
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
				const episodeRefs = episodeRequests.map(({ parentEntityId, unresolvedEpisode }, index) =>
					unresolvedEpisode.type === "show"
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
							},
				);
				const episodeOutput =
					episodeRefs.length > 0
						? yield* replay.activity(`episodes-${batchIndex}`, episodes, { refs: episodeRefs })
						: { results: [] };
				const answeredRequests = new Set<number>();
				const episodeEntityIdByEvent = new Map<string, string | null>();
				for (const result of episodeOutput.results) {
					const request = episodeRequests[result.index];
					if (!request) {
						throw new Error(`Episode resolution returned an unexpected index ${result.index}`);
					}
					if (answeredRequests.has(result.index)) {
						throw new Error(`Episode resolution returned a duplicate index ${result.index}`);
					}
					answeredRequests.add(result.index);
					episodeEntityIdByEvent.set(
						`${request.groupIndex}:${request.eventIndex}`,
						result.entityId,
					);
				}
				const unansweredRequests = episodeRequests.flatMap((_, index) =>
					answeredRequests.has(index) ? [] : [index],
				);
				if (unansweredRequests.length > 0) {
					throw new Error(`Episode resolution omitted indices ${unansweredRequests.join(", ")}`);
				}
				const episodeFailures: MediaImportAdapterFailure[] = [];
				const finalizedGroups: FinalizedEntityGroup[] = [];
				for (const [groupIndex, group] of resolvedGroups.entries()) {
					const events: FinalizedEvent[] = [];
					for (const [eventIndex, event] of group.events.entries()) {
						const finalized = {
							occurredAt: event.occurredAt,
							properties: event.properties,
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
								itemIndex: group.itemIndex,
								stage: "provider_resolution",
								sourceLabel: group.entityRef.sourceLabel,
								entitySchemaSlug: group.entityRef.entitySchemaSlug,
								message: unresolvedEpisodeMessage(event.unresolvedEpisode),
								sourceIdentifier: importEntityRefIdentifier(group.entityRef),
							});
							continue;
						}
						events.push({ ...finalized, subjectEntityId });
					}
					finalizedGroups.push({ ...group, events });
				}
				const chunk = yield* replay.activity(`chunks-${batchIndex}`, chunkWriter, {
					entityGroups: finalizedGroups,
					populationResults: populationOutput.results,
					failures: [...batch.failures, ...episodeFailures],
				});
				chunkFiles.push(...chunk.chunkFiles);
				totalItems += chunk.totalItems;
				failureCount += chunk.failureCount;
				writeItemCount += chunk.writeItemCount;
				start += BATCH_SIZE;
				if (isIntegration) {
					break;
				}
				if (batch.totalItems === 0) {
					break;
				}
				if (start >= batch.totalItems) {
					break;
				}
			}

			return yield* replay.child("write-import", kernelImport, {
				totalItems,
				chunkFiles,
				runId: input.runId,
				failureCount,
				writeItemCount,
				...(isIntegration ? { integrationId } : {}),
			});
		}),
});
