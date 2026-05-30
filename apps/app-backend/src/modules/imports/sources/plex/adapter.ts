import { dayjs } from "@ryot/ts-utils/dayjs";
import { z } from "zod";

import { createCompleteEvent, finalizeEntityGroups } from "../../media/book/shared";
import { getOrCreateMediaEntityGroup } from "../../media/groups";
import type {
	MediaImportAdapterResult,
	MediaImportAdapterFailure,
} from "../../media/import-processor";
import {
	createImportSourceFailure,
	mapWithConcurrency,
	requestSourceJson,
	type SourceJsonRequestInput,
} from "../../runtime/source-api";
import { buildMovieOrShowImportRef } from "../shared/provider-refs";

const PLEX_CONCURRENCY = 5;

const plexGuidSchema = z.object({ id: z.string() });

const plexDirectorySchema = z.object({
	key: z.string(),
	type: z.string(),
	title: z.string(),
});

const plexMetadataItemSchema = z.object({
	key: z.string(),
	type: z.string(),
	title: z.string(),
	ratingKey: z.string().optional(),
	index: z.number().int().optional(),
	parentIndex: z.number().int().optional(),
	Guid: z.array(plexGuidSchema).optional(),
	lastViewedAt: z.number().int().or(z.string()).optional(),
});

const plexDirectoriesResponseSchema = z.object({
	MediaContainer: z.object({ Directory: z.array(plexDirectorySchema).default([]) }),
});

const plexMetadataResponseSchema = z.object({
	MediaContainer: z.object({ Metadata: z.array(plexMetadataItemSchema).optional() }),
});

type PlexAdapterInput = {
	apiKey: string;
	apiUrl: string;
	allowInsecureConnections?: boolean;
};

type PlexImportAdapterDeps = {
	mapWithConcurrency: typeof mapWithConcurrency;
	requestJson: <T>(input: SourceJsonRequestInput) => Promise<T>;
};

const plexImportAdapterDeps: PlexImportAdapterDeps = {
	mapWithConcurrency,
	requestJson: requestSourceJson,
};

const normalizeOccurredAt = (value: number | string | undefined): string | null => {
	if (typeof value === "number") {
		const parsed = dayjs.unix(value);
		return parsed.isValid() ? parsed.toISOString() : null;
	}
	if (typeof value === "string") {
		const parsed = dayjs(value);
		return parsed.isValid() ? parsed.toISOString() : null;
	}
	return null;
};

const getGuidProviderIds = (guids: Array<{ id: string }> | undefined) => {
	const getProviderId = (prefix: string) => {
		const match = guids?.find((guid) => guid.id.startsWith(`${prefix}://`));
		return match?.id.slice(prefix.length + 3);
	};

	return {
		imdb: getProviderId("imdb"),
		tmdb: getProviderId("tmdb"),
		tvdb: getProviderId("tvdb"),
	};
};

const createPlexHeaders = (apiKey: string): Record<string, string> => ({
	"X-Plex-Token": apiKey,
	Accept: "application/json",
});

const createPlexItemFailure = (input: {
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

export const adaptPlexData = async (
	input: PlexAdapterInput,
	deps: PlexImportAdapterDeps = plexImportAdapterDeps,
): Promise<MediaImportAdapterResult> => {
	const host = new URL(input.apiUrl).host;
	const headers = createPlexHeaders(input.apiKey);
	const failures: MediaImportAdapterFailure[] = [];
	const groupMap = new Map<string, ReturnType<typeof getOrCreateMediaEntityGroup>>();

	const librariesResponse = plexDirectoriesResponseSchema.parse(
		await deps.requestJson({
			headers,
			sourceName: "Plex",
			baseUrl: input.apiUrl,
			path: "library/sections",
			allowInsecureConnections: input.allowInsecureConnections,
		}),
	);

	let nextItemIndex = 0;
	// oxlint-disable no-await-in-loop
	for (const directory of librariesResponse.MediaContainer.Directory) {
		if (directory.type !== "movie" && directory.type !== "show") {
			continue;
		}

		const itemsResponse = plexMetadataResponseSchema.parse(
			await deps.requestJson({
				headers,
				sourceName: "Plex",
				baseUrl: input.apiUrl,
				query: { includeGuids: 1 },
				path: `library/sections/${directory.key}/all`,
				allowInsecureConnections: input.allowInsecureConnections,
			}),
		);

		const sectionItems = itemsResponse.MediaContainer.Metadata ?? [];
		const sectionFailures = await deps.mapWithConcurrency(
			sectionItems,
			PLEX_CONCURRENCY,
			async (rawItem, offset) => {
				const itemIndex = nextItemIndex + offset;
				const occurredAt = normalizeOccurredAt(rawItem.lastViewedAt);
				if (!occurredAt) {
					return null;
				}

				const entitySchemaSlug = directory.type === "movie" ? "movie" : "show";
				const ref = buildMovieOrShowImportRef({
					entitySchemaSlug,
					sourceLabel: rawItem.title,
					providerIds: getGuidProviderIds(rawItem.Guid),
				});
				if (!ref) {
					return {
						itemIndex,
						sourceLabel: rawItem.title,
						sourceIdentifier: rawItem.key,
						stage: "input_transformation",
						message: "Plex item has no TMDB, TVDB, or IMDb identifier",
					} satisfies MediaImportAdapterFailure;
				}

				if (directory.type === "movie") {
					const group = getOrCreateMediaEntityGroup(groupMap, ref, itemIndex);
					group.events.push(createCompleteEvent({ occurredAt, completedOn: occurredAt }));
					return null;
				}

				if (!rawItem.ratingKey) {
					return {
						itemIndex,
						sourceLabel: rawItem.title,
						stage: "input_transformation",
						sourceIdentifier: rawItem.key,
						message: "Plex show has no rating key",
					} satisfies MediaImportAdapterFailure;
				}

				let leavesResponse: z.infer<typeof plexMetadataResponseSchema>;
				try {
					leavesResponse = plexMetadataResponseSchema.parse(
						await deps.requestJson({
							headers,
							sourceName: "Plex",
							baseUrl: input.apiUrl,
							path: `library/metadata/${rawItem.ratingKey}/allLeaves`,
							allowInsecureConnections: input.allowInsecureConnections,
						}),
					);
				} catch (error) {
					return createPlexItemFailure({
						host,
						error,
						itemIndex,
						sourceLabel: rawItem.title,
						sourceIdentifier: rawItem.key,
						message: "Failed to fetch watched episodes from Plex",
					});
				}

				const group = getOrCreateMediaEntityGroup(groupMap, ref, itemIndex);
				let importedEpisodeCount = 0;
				for (const leaf of leavesResponse.MediaContainer.Metadata ?? []) {
					const leafOccurredAt = normalizeOccurredAt(leaf.lastViewedAt);
					if (!leafOccurredAt || leaf.parentIndex == null || leaf.index == null) {
						continue;
					}
					group.events.push({
						occurredAt: leafOccurredAt,
						eventSchemaSlug: "progress",
						properties: {
							progressPercent: 100,
							showEpisode: leaf.index,
							showSeason: leaf.parentIndex,
						},
					});
					importedEpisodeCount += 1;
				}

				if (importedEpisodeCount === 0) {
					return null;
				}

				return null;
			},
		);

		failures.push(...sectionFailures.filter(isAdapterFailure));
		nextItemIndex += sectionItems.length;
	}
	// oxlint-enable no-await-in-loop

	return { failures, entityGroups: finalizeEntityGroups(groupMap) };
};
