import { dayjs } from "@ryot/ts-utils/dayjs";
import { z } from "zod";

import type { ImportEntityRef, ImportMediaEntityGroup } from "~/modules/imports/jobs";
import {
	finalizeEntityGroups,
	isValidIsbn,
	normalizeIsbn,
} from "~/modules/imports/media/book/shared";
import { getOrCreateMediaEntityGroup } from "~/modules/imports/media/groups";
import type {
	MediaImportAdapterFailure,
	MediaImportAdapterResult,
} from "~/modules/imports/media/import-processor";
import {
	mapWithConcurrency,
	requestSourceJson,
	type SourceJsonRequestInput,
} from "~/modules/imports/runtime/source-api";

const ABS_CONCURRENCY = 5;

const librarySchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	mediaType: z.enum(["book", "podcast"]).optional(),
});

const progressSchema = z
	.object({
		progress: z.number().optional(),
		isFinished: z.boolean().optional(),
		ebookProgress: z.number().optional(),
	})
	.optional();

const episodeSchema = z.object({
	title: z.string(),
	id: z.string().optional(),
	index: z.number().int().optional(),
	number: z.number().int().optional(),
	sequence: z.number().int().optional(),
	episodeNumber: z.number().int().optional(),
	episode: z.number().int().or(z.string()).optional(),
});

const metadataSchema = z.object({
	title: z.string(),
	asin: z.string().optional().nullable(),
	isbn: z.string().optional().nullable(),
	itunesId: z.string().optional().nullable(),
});

const mediaSchema = z.object({
	metadata: metadataSchema,
	ebookFormat: z.string().optional().nullable(),
	episodes: z.array(episodeSchema).optional(),
});

const itemSchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	media: mediaSchema.optional(),
	progressId: z.string().optional(),
	userMediaProgress: progressSchema,
	mediaType: z.enum(["book", "podcast"]).optional(),
});

const inProgressResponseSchema = z.object({
	libraryItems: z.array(itemSchema).optional().default([]),
	episodeItems: z
		.array(
			z.object({
				id: z.string(),
				name: z.string().optional(),
				media: mediaSchema.optional(),
				episode: episodeSchema.optional(),
				progressId: z.string().optional(),
				userMediaProgress: progressSchema,
				recentEpisode: episodeSchema.optional(),
				mediaType: z.enum(["book", "podcast"]).optional(),
			}),
		)
		.optional()
		.default([]),
});

const librariesResponseSchema = z.object({
	libraries: z.array(librarySchema),
});

const libraryItemsResponseSchema = z.object({
	results: z.array(itemSchema),
});

type AbsInput = {
	token: string;
	baseUrl: string;
};

type AbsAdapterDeps = {
	mapWithConcurrency: typeof mapWithConcurrency;
	requestJson: <T>(input: SourceJsonRequestInput) => Promise<T>;
};

const defaultDeps: AbsAdapterDeps = {
	mapWithConcurrency,
	requestJson: requestSourceJson,
};

const buildHeaders = (token: string): Record<string, string> => ({
	Accept: "application/json",
	Authorization: `Bearer ${token}`,
});

const resolveEpisodeNumber = (ep: z.infer<typeof episodeSchema>): number | null => {
	if (ep.episodeNumber != null) {
		return ep.episodeNumber;
	}
	if (ep.number != null) {
		return ep.number;
	}
	if (ep.index != null) {
		return ep.index;
	}
	if (ep.sequence != null) {
		return ep.sequence;
	}
	if (typeof ep.episode === "number") {
		return ep.episode;
	}
	if (typeof ep.episode === "string") {
		const n = Number.parseInt(ep.episode.trim(), 10);
		return Number.isFinite(n) ? n : null;
	}
	return null;
};

export const fetchAudiobookshelfProgress = async (
	input: AbsInput,
	deps: AbsAdapterDeps = defaultDeps,
): Promise<MediaImportAdapterResult> => {
	const now = dayjs().toISOString();
	const headers = buildHeaders(input.token);
	const failures: MediaImportAdapterFailure[] = [];
	const groupMap = new Map<string, ImportMediaEntityGroup>();
	const baseUrl = input.baseUrl.endsWith("/api") ? input.baseUrl : `${input.baseUrl}/api`;

	const inProgress = inProgressResponseSchema.parse(
		await deps.requestJson({
			headers,
			baseUrl,
			path: "me/items-in-progress",
			sourceName: "Audiobookshelf",
		}),
	);

	let itemIndex = 0;

	const allItems = [
		...inProgress.libraryItems.map((item) => ({
			item,
			episode: undefined as z.infer<typeof episodeSchema> | undefined,
		})),
		...inProgress.episodeItems.map((item) => ({
			item: { ...item, media: item.media },
			episode: item.episode ?? item.recentEpisode,
		})),
	];

	const results = await deps.mapWithConcurrency(
		allItems,
		ABS_CONCURRENCY,
		// oxlint-disable-next-line require-await
		async ({ item, episode }, offset) => {
			const idx = itemIndex + offset;
			const metadata = item.media?.metadata;
			if (!metadata) {
				return {
					failure: {
						itemIndex: idx,
						sourceLabel: item.name,
						sourceIdentifier: item.id,
						stage: "input_transformation" as const,
						message: "Audiobookshelf item is missing media metadata",
					},
				};
			}

			const sourceLabel = metadata.title;
			const userProgress = item.userMediaProgress;

			if (userProgress?.isFinished) {
				return null;
			}

			const rawProgress = Math.max(userProgress?.progress ?? 0, userProgress?.ebookProgress ?? 0);
			const progressPercent = Math.min(Math.round(rawProgress * 100 * 100) / 100, 99);
			if (progressPercent <= 0) {
				return null;
			}

			if (episode) {
				const episodeNumber = resolveEpisodeNumber(episode);
				if (episodeNumber == null) {
					return null;
				}
				const itunesId = metadata.itunesId?.trim();
				if (!itunesId) {
					return {
						failure: {
							sourceLabel,
							itemIndex: idx,
							sourceIdentifier: item.id,
							stage: "input_transformation" as const,
							message: "Audiobookshelf podcast item has no iTunes identifier",
						},
					};
				}
				const ref: ImportEntityRef = {
					sourceLabel,
					kind: "resolved",
					externalId: itunesId,
					entitySchemaSlug: "podcast",
					scriptSlug: "podcast.itunes",
				};
				const group = getOrCreateMediaEntityGroup(groupMap, ref, idx);
				group.events.push({
					occurredAt: now,
					eventSchemaSlug: "progress",
					properties: {
						progressPercent,
						consumedOn: "audiobookshelf",
						podcastEpisode: episodeNumber,
					},
				});
				return null;
			}

			if (item.media?.ebookFormat === "epub") {
				const isbn = metadata.isbn ? normalizeIsbn(metadata.isbn) : "";
				if (!isbn || !isValidIsbn(isbn)) {
					return {
						failure: {
							sourceLabel,
							itemIndex: idx,
							sourceIdentifier: item.id,
							stage: "input_transformation" as const,
							message: "Audiobookshelf ebook is missing a valid ISBN",
						},
					};
				}
				const ref: ImportEntityRef = {
					sourceLabel,
					kind: "unresolved",
					identifierValue: isbn,
					identifierType: "isbn",
					entitySchemaSlug: "book",
				};
				const group = getOrCreateMediaEntityGroup(groupMap, ref, idx);
				group.events.push({
					occurredAt: now,
					eventSchemaSlug: "progress",
					properties: { progressPercent, consumedOn: "audiobookshelf" },
				});
				return null;
			}

			const asin = metadata.asin?.trim();
			if (asin) {
				const ref: ImportEntityRef = {
					sourceLabel,
					kind: "resolved",
					externalId: asin,
					entitySchemaSlug: "audiobook",
					scriptSlug: "audiobook.audible",
				};
				const group = getOrCreateMediaEntityGroup(groupMap, ref, idx);
				group.events.push({
					occurredAt: now,
					eventSchemaSlug: "progress",
					properties: { progressPercent, consumedOn: "audiobookshelf" },
				});
				return null;
			}

			return {
				failure: {
					sourceLabel,
					itemIndex: idx,
					sourceIdentifier: item.id,
					stage: "input_transformation" as const,
					message: "Audiobookshelf item has no ASIN, ISBN, or iTunes identifier",
				},
			};
		},
	);

	itemIndex += allItems.length;

	for (const result of results) {
		if (result?.failure) {
			failures.push(result.failure);
		}
	}

	return { failures, entityGroups: finalizeEntityGroups(groupMap) };
};

export const syncAudiobookshelfOwnedItems = async (
	input: AbsInput,
	deps: AbsAdapterDeps = defaultDeps,
): Promise<Array<{ entityRef: ImportEntityRef; provider: string }>> => {
	const baseUrl = input.baseUrl.endsWith("/api") ? input.baseUrl : `${input.baseUrl}/api`;
	const headers = buildHeaders(input.token);

	const librariesResp = librariesResponseSchema.parse(
		await deps.requestJson({ headers, baseUrl, path: "libraries", sourceName: "Audiobookshelf" }),
	);

	const ownedItems: Array<{ entityRef: ImportEntityRef; provider: string }> = [];

	for (const library of librariesResp.libraries) {
		// oxlint-disable-next-line no-await-in-loop
		let items: z.infer<typeof itemSchema>[];
		try {
			items = libraryItemsResponseSchema.parse(
				// oxlint-disable-next-line no-await-in-loop
				await deps.requestJson({
					headers,
					baseUrl,
					query: { expanded: 1 },
					sourceName: "Audiobookshelf",
					path: `libraries/${library.id}/items`,
				}),
			).results;
		} catch {
			continue;
		}

		for (const item of items) {
			const metadata = item.media?.metadata;
			if (!metadata) {
				continue;
			}
			const sourceLabel = metadata.title;

			if (item.media?.ebookFormat === "epub") {
				const isbn = metadata.isbn ? normalizeIsbn(metadata.isbn) : "";
				if (!isbn || !isValidIsbn(isbn)) {
					continue;
				}
				ownedItems.push({
					provider: "audiobookshelf",
					entityRef: {
						sourceLabel,
						kind: "unresolved",
						identifierValue: isbn,
						identifierType: "isbn",
						entitySchemaSlug: "book",
					},
				});
				continue;
			}

			const asin = metadata.asin?.trim();
			if (asin) {
				ownedItems.push({
					provider: "audiobookshelf",
					entityRef: {
						sourceLabel,
						kind: "resolved",
						externalId: asin,
						entitySchemaSlug: "audiobook",
						scriptSlug: "audiobook.audible",
					},
				});
				continue;
			}

			const itunesId = metadata.itunesId?.trim();
			if (itunesId) {
				ownedItems.push({
					provider: "audiobookshelf",
					entityRef: {
						sourceLabel,
						kind: "resolved",
						externalId: itunesId,
						entitySchemaSlug: "podcast",
						scriptSlug: "podcast.itunes",
					},
				});
			}
		}
	}

	return ownedItems;
};
