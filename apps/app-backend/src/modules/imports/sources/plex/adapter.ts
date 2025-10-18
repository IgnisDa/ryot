import { Effect, Either, Schema } from "effect";

import { createCompleteEvent, finalizeEntityGroups } from "../../media/book/shared";
import { parseDateInput } from "../../media/dates";
import { getOrCreateMediaEntityGroup } from "../../media/groups";
import type {
	MediaImportAdapterFailure,
	MediaImportAdapterResult,
} from "../../media/import-processor";
import type { ImportEntityRef, ImportMediaEntityGroup } from "../../media/types";
import { requestSourceJson } from "../../runtime/source-api";
import { createSourceFetchFailure, isNotNullAdapterFailure } from "../shared/adapter-utils";
import { buildMovieOrShowImportRef } from "../shared/provider-refs";

const PLEX_CONCURRENCY = 5;

const PlexGuid = Schema.Struct({ id: Schema.String });

const PlexDirectory = Schema.Struct({
	key: Schema.String,
	type: Schema.String,
	title: Schema.String,
});

const PlexMetadataItem = Schema.Struct({
	key: Schema.String,
	type: Schema.String,
	title: Schema.String,
	index: Schema.optional(Schema.Int),
	parentIndex: Schema.optional(Schema.Int),
	ratingKey: Schema.optional(Schema.String),
	Guid: Schema.optional(Schema.Array(PlexGuid)),
	lastViewedAt: Schema.optional(Schema.Union(Schema.Int, Schema.String)),
});

const PlexDirectoriesResponse = Schema.Struct({
	MediaContainer: Schema.Struct({
		Directory: Schema.optionalWith(Schema.Array(PlexDirectory), { default: () => [] }),
	}),
});

const PlexMetadataResponse = Schema.Struct({
	MediaContainer: Schema.Struct({ Metadata: Schema.optional(Schema.Array(PlexMetadataItem)) }),
});

const decodeDirectories = Schema.decodeUnknown(PlexDirectoriesResponse);
const decodeMetadata = Schema.decodeUnknown(PlexMetadataResponse);

type PlexAdapterInput = {
	apiKey: string;
	apiUrl: string;
	allowInsecureConnections?: boolean;
};

const getGuidProviderIds = (guids: ReadonlyArray<{ id: string }> | undefined) => {
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

export const adaptPlexData = Effect.fn("plexAdapter.adaptData")(function* (
	input: PlexAdapterInput,
) {
	const host = new URL(input.apiUrl).host;
	const headers = createPlexHeaders(input.apiKey);
	const failures: MediaImportAdapterFailure[] = [];
	const groupMap = new Map<string, ImportMediaEntityGroup>();

	const librariesResponse = yield* requestSourceJson({
		headers,
		sourceName: "Plex",
		baseUrl: input.apiUrl,
		path: "library/sections",
		allowInsecureConnections: input.allowInsecureConnections,
	}).pipe(Effect.flatMap(decodeDirectories));

	let nextItemIndex = 0;
	for (const directory of librariesResponse.MediaContainer.Directory) {
		if (directory.type !== "movie" && directory.type !== "show") {
			continue;
		}

		const itemsResponse = yield* requestSourceJson({
			headers,
			sourceName: "Plex",
			baseUrl: input.apiUrl,
			query: { includeGuids: 1 },
			path: `library/sections/${directory.key}/all`,
			allowInsecureConnections: input.allowInsecureConnections,
		}).pipe(Effect.flatMap(decodeMetadata));

		const sectionItems = itemsResponse.MediaContainer.Metadata ?? [];
		const startItemIndex = nextItemIndex;
		const sectionFailures = yield* Effect.forEach(
			sectionItems,
			(rawItem, offset) =>
				Effect.gen(function* () {
					const itemIndex = startItemIndex + offset;
					const occurredAt = parseDateInput(rawItem.lastViewedAt, { unixSeconds: true });
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

					const leavesResult = yield* requestSourceJson({
						headers,
						sourceName: "Plex",
						baseUrl: input.apiUrl,
						path: `library/metadata/${rawItem.ratingKey}/allLeaves`,
						allowInsecureConnections: input.allowInsecureConnections,
					}).pipe(Effect.flatMap(decodeMetadata), Effect.either);
					if (Either.isLeft(leavesResult)) {
						return createSourceFetchFailure({
							host,
							itemIndex,
							error: leavesResult.left,
							sourceLabel: rawItem.title,
							sourceIdentifier: rawItem.key,
							message: "Failed to fetch watched episodes from Plex",
						});
					}

					const group = getOrCreateMediaEntityGroup(groupMap, ref, itemIndex);
					for (const leaf of leavesResult.right.MediaContainer.Metadata ?? []) {
						const leafOccurredAt = parseDateInput(leaf.lastViewedAt, { unixSeconds: true });
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
					}

					return null;
				}),
			{ concurrency: PLEX_CONCURRENCY },
		);

		failures.push(...sectionFailures.filter(isNotNullAdapterFailure));
		nextItemIndex += sectionItems.length;
	}

	return {
		failures,
		entityGroups: finalizeEntityGroups(groupMap),
	} satisfies MediaImportAdapterResult;
});

export const syncPlexYankOwnedItems = Effect.fn("plexAdapter.syncOwnedItems")(function* (input: {
	apiKey: string;
	apiUrl: string;
}) {
	const headers = createPlexHeaders(input.apiKey);
	const ownedItems: Array<{ entityRef: ImportEntityRef; provider: string }> = [];

	const librariesResponse = yield* requestSourceJson({
		headers,
		sourceName: "Plex",
		baseUrl: input.apiUrl,
		path: "library/sections",
	}).pipe(Effect.flatMap(decodeDirectories));

	for (const directory of librariesResponse.MediaContainer.Directory) {
		if (directory.type !== "movie" && directory.type !== "show") {
			continue;
		}

		const itemsResult = yield* requestSourceJson({
			headers,
			sourceName: "Plex",
			baseUrl: input.apiUrl,
			query: { includeGuids: 1 },
			path: `library/sections/${directory.key}/all`,
		}).pipe(Effect.flatMap(decodeMetadata), Effect.either);
		if (Either.isLeft(itemsResult)) {
			continue;
		}

		const entitySchemaSlug = directory.type === "movie" ? "movie" : "show";
		for (const item of itemsResult.right.MediaContainer.Metadata ?? []) {
			const ref = buildMovieOrShowImportRef({
				entitySchemaSlug,
				sourceLabel: item.title,
				providerIds: getGuidProviderIds(item.Guid),
			});
			if (ref) {
				ownedItems.push({ entityRef: ref, provider: "plex_yank" });
			}
		}
	}

	return ownedItems;
});
