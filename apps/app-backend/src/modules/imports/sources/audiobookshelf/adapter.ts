import { dayjs } from "@ryot/ts-utils/dayjs";
import { z } from "zod";

import {
	addCollectionMembership,
	createCompleteEvent,
	finalizeEntityGroups,
	isValidIsbn,
	normalizeIsbn,
} from "../../media/book/shared";
import { getOrCreateMediaEntityGroup } from "../../media/groups";
import type {
	MediaImportAdapterFailure,
	MediaImportAdapterResult,
} from "../../media/import-processor";
import {
	createImportSourceFailure,
	mapWithConcurrency,
	requestSourceJson,
	type SourceJsonRequestInput,
} from "../../runtime/source-api";

const AUDIOBOOKSHELF_CONCURRENCY = 5;
const FINISHED_FILTER = Buffer.from("finished", "utf8").toString("base64");

const audiobookshelfLibrarySchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	mediaType: z.enum(["book", "podcast"]).optional(),
});

const audiobookshelfProgressSchema = z
	.object({
		progress: z.number().optional(),
		isFinished: z.boolean().optional(),
		ebookProgress: z.number().optional(),
	})
	.optional();

const audiobookshelfEpisodeSchema = z.object({
	title: z.string(),
	id: z.string().optional(),
	index: z.number().int().optional(),
	number: z.number().int().optional(),
	sequence: z.number().int().optional(),
	episodeNumber: z.number().int().optional(),
	episode: z.number().int().or(z.string()).optional(),
});

const audiobookshelfMetadataSchema = z.object({
	title: z.string(),
	asin: z.string().optional().nullable(),
	isbn: z.string().optional().nullable(),
	itunesId: z.string().optional().nullable(),
});

const audiobookshelfMediaSchema = z.object({
	metadata: audiobookshelfMetadataSchema,
	ebookFormat: z.string().optional().nullable(),
	episodes: z.array(audiobookshelfEpisodeSchema).optional(),
});

const audiobookshelfItemSchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	media: audiobookshelfMediaSchema.optional(),
	userMediaProgress: audiobookshelfProgressSchema,
	mediaType: z.enum(["book", "podcast"]).optional(),
});

const audiobookshelfLibrariesResponseSchema = z.object({
	libraries: z.array(audiobookshelfLibrarySchema),
});

const audiobookshelfListResponseSchema = z.object({
	results: z.array(audiobookshelfItemSchema),
});

type AudiobookshelfAdapterInput = {
	apiKey: string;
	apiUrl: string;
	allowInsecureConnections?: boolean;
};

type AudiobookshelfImportAdapterDeps = {
	mapWithConcurrency: typeof mapWithConcurrency;
	requestJson: <T>(input: SourceJsonRequestInput) => Promise<T>;
};

const audiobookshelfImportAdapterDeps: AudiobookshelfImportAdapterDeps = {
	mapWithConcurrency,
	requestJson: requestSourceJson,
};

const createHeaders = (apiKey: string): Record<string, string> => ({
	Accept: "application/json",
	Authorization: `Bearer ${apiKey}`,
});

const getPodcastEpisodeNumber = (
	episode: z.infer<typeof audiobookshelfEpisodeSchema>,
): number | null => {
	if (episode.episodeNumber != null) {
		return episode.episodeNumber;
	}
	if (episode.number != null) {
		return episode.number;
	}
	if (episode.index != null) {
		return episode.index;
	}
	if (episode.sequence != null) {
		return episode.sequence;
	}
	if (typeof episode.episode === "number") {
		return episode.episode;
	}
	if (typeof episode.episode === "string") {
		const parsed = Number.parseInt(episode.episode.trim(), 10);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
};

const createAudiobookshelfItemFailure = (input: {
	host: string;
	error: unknown;
	message: string;
	itemIndex: number;
	sourceLabel?: string;
	sourceIdentifier?: string;
}): MediaImportAdapterFailure =>
	createImportSourceFailure({
		host: input.host,
		error: input.error,
		stage: "source_fetch",
		message: input.message,
		itemIndex: input.itemIndex,
		sourceLabel: input.sourceLabel,
		sourceIdentifier: input.sourceIdentifier,
	});

const isAdapterFailure = (
	value: MediaImportAdapterFailure | null,
): value is MediaImportAdapterFailure => value !== null;

export const adaptAudiobookshelfData = async (
	input: AudiobookshelfAdapterInput,
	deps: AudiobookshelfImportAdapterDeps = audiobookshelfImportAdapterDeps,
): Promise<MediaImportAdapterResult> => {
	const baseUrl = input.apiUrl.endsWith("/api") ? input.apiUrl : `${input.apiUrl}/api`;
	const importedAt = dayjs().toISOString();
	const headers = createHeaders(input.apiKey);
	const host = new URL(input.apiUrl).host;
	const failures: MediaImportAdapterFailure[] = [];
	const groupMap = new Map<string, ReturnType<typeof getOrCreateMediaEntityGroup>>();

	const librariesResponse = audiobookshelfLibrariesResponseSchema.parse(
		await deps.requestJson({
			headers,
			baseUrl,
			path: "libraries",
			sourceName: "Audiobookshelf",
			allowInsecureConnections: input.allowInsecureConnections,
		}),
	);

	let nextItemIndex = 0;
	// oxlint-disable no-await-in-loop
	for (const library of librariesResponse.libraries) {
		let items: Array<z.infer<typeof audiobookshelfItemSchema>>;
		try {
			items = audiobookshelfListResponseSchema.parse(
				await deps.requestJson({
					headers,
					baseUrl,
					sourceName: "Audiobookshelf",
					path: `libraries/${library.id}/items`,
					allowInsecureConnections: input.allowInsecureConnections,
					query: {
						expanded: 1,
						...(library.mediaType === "book" ? { filter: `progress.${FINISHED_FILTER}` } : {}),
					},
				}),
			).results;
		} catch (error) {
			failures.push(
				createAudiobookshelfItemFailure({
					host,
					error,
					itemIndex: nextItemIndex,
					sourceLabel: library.name,
					sourceIdentifier: library.id,
					message: "Failed to fetch Audiobookshelf library items",
				}),
			);
			continue;
		}

		const libraryFailures = await deps.mapWithConcurrency(
			items,
			AUDIOBOOKSHELF_CONCURRENCY,
			async (item, offset) => {
				const itemIndex = nextItemIndex + offset;
				const metadata = item.media?.metadata;
				if (!metadata) {
					return {
						itemIndex,
						sourceLabel: item.name,
						sourceIdentifier: item.id,
						stage: "input_transformation",
						message: "Audiobookshelf item is missing media metadata",
					} satisfies MediaImportAdapterFailure;
				}

				const sourceLabel = metadata.title;
				const libraryName = library.name?.trim();
				if (item.media?.ebookFormat === "epub") {
					const isbn = metadata.isbn ? normalizeIsbn(metadata.isbn) : "";
					if (!isbn || !isValidIsbn(isbn)) {
						return {
							itemIndex,
							sourceLabel,
							sourceIdentifier: item.id,
							stage: "input_transformation",
							message: "Audiobookshelf ebook is missing a valid ISBN",
						} satisfies MediaImportAdapterFailure;
					}

					const group = getOrCreateMediaEntityGroup(
						groupMap,
						{
							sourceLabel,
							kind: "unresolved",
							identifierValue: isbn,
							identifierType: "isbn",
							entitySchemaSlug: "book",
						},
						itemIndex,
					);
					group.events.push(
						createCompleteEvent({ occurredAt: importedAt, completedOn: importedAt }),
					);
					if (libraryName) {
						addCollectionMembership(group, libraryName);
					}
					return null;
				}

				const asin = metadata.asin?.trim();
				if (asin) {
					const group = getOrCreateMediaEntityGroup(
						groupMap,
						{
							sourceLabel,
							kind: "resolved",
							externalId: asin,
							entitySchemaSlug: "audiobook",
							scriptSlug: "audiobook.audible",
						},
						itemIndex,
					);
					group.events.push(
						createCompleteEvent({ occurredAt: importedAt, completedOn: importedAt }),
					);
					if (libraryName) {
						addCollectionMembership(group, libraryName);
					}
					return null;
				}

				const itunesId = metadata.itunesId?.trim();
				if (!itunesId) {
					return {
						itemIndex,
						sourceLabel,
						sourceIdentifier: item.id,
						stage: "input_transformation",
						message: "Audiobookshelf item has no Audible, ISBN, or iTunes identifier",
					} satisfies MediaImportAdapterFailure;
				}

				let itemDetails: z.infer<typeof audiobookshelfItemSchema>;
				try {
					itemDetails = audiobookshelfItemSchema.parse(
						await deps.requestJson({
							headers,
							baseUrl,
							path: `items/${item.id}`,
							sourceName: "Audiobookshelf",
							query: { expanded: 1, include: "progress" },
							allowInsecureConnections: input.allowInsecureConnections,
						}),
					);
				} catch (error) {
					return createAudiobookshelfItemFailure({
						error,
						host,
						itemIndex,
						sourceLabel,
						sourceIdentifier: item.id,
						message: "Failed to fetch Audiobookshelf podcast details",
					});
				}

				const episodes = itemDetails.media?.episodes ?? [];
				if (episodes.length === 0) {
					return {
						itemIndex,
						sourceLabel,
						sourceIdentifier: item.id,
						stage: "input_transformation",
						message: "Audiobookshelf podcast has no episodes",
					} satisfies MediaImportAdapterFailure;
				}

				const podcastEvents: Array<{
					occurredAt: string;
					eventSchemaSlug: string;
					properties: Record<string, unknown>;
				}> = [];
				let importedEpisodeCount = 0;
				// oxlint-disable no-await-in-loop
				for (const episode of episodes) {
					if (!episode.id) {
						continue;
					}

					let episodeDetails: z.infer<typeof audiobookshelfItemSchema>;
					try {
						episodeDetails = audiobookshelfItemSchema.parse(
							await deps.requestJson({
								headers,
								baseUrl,
								path: `items/${item.id}`,
								sourceName: "Audiobookshelf",
								allowInsecureConnections: input.allowInsecureConnections,
								query: { expanded: 1, include: "progress", episode: episode.id },
							}),
						);
					} catch (error) {
						failures.push(
							createAudiobookshelfItemFailure({
								host,
								error,
								itemIndex,
								sourceLabel,
								sourceIdentifier: item.id,
								message: "Failed to fetch Audiobookshelf podcast episode progress",
							}),
						);
						continue;
					}

					if (!episodeDetails.userMediaProgress?.isFinished) {
						continue;
					}

					const podcastEpisode = getPodcastEpisodeNumber(episode);
					if (podcastEpisode == null) {
						continue;
					}

					podcastEvents.push({
						occurredAt: importedAt,
						eventSchemaSlug: "progress",
						properties: { progressPercent: 100, podcastEpisode },
					});
					importedEpisodeCount += 1;
				}
				// oxlint-enable no-await-in-loop

				if (importedEpisodeCount === 0) {
					return {
						itemIndex,
						sourceLabel,
						sourceIdentifier: item.id,
						stage: "input_transformation",
						message:
							"Audiobookshelf podcast has no finished episodes with importable episode numbers",
					} satisfies MediaImportAdapterFailure;
				}

				const group = getOrCreateMediaEntityGroup(
					groupMap,
					{
						sourceLabel,
						kind: "resolved",
						externalId: itunesId,
						entitySchemaSlug: "podcast",
						scriptSlug: "podcast.itunes",
					},
					itemIndex,
				);
				group.events.push(...podcastEvents);
				if (libraryName) {
					addCollectionMembership(group, libraryName);
				}

				return null;
			},
		);

		failures.push(...libraryFailures.filter(isAdapterFailure));
		nextItemIndex += items.length;
	}
	// oxlint-enable no-await-in-loop

	return { failures, entityGroups: finalizeEntityGroups(groupMap) };
};
