import { Effect, Either, Schema } from "@ryot/sandbox-sdk/effect";

import { parseDateInput } from "./dates";
import { getOrCreateMediaEntityGroup, type ImportMediaEntityGroupBuilder } from "./groups";
import { createCompleteEvent, finalizeEntityGroups } from "./helpers";
import type { MediaImportAdapterFailure } from "./schemas";
import {
	requestSourceJson,
	sourceApiHost,
	withSourceRequestOptions,
	type HttpHost,
} from "./source-api";
import { movieOrShowImportRef, sourceFetchFailure } from "./source-helpers";

const Guid = Schema.Struct({ id: Schema.String });
const Directory = Schema.Struct({ key: Schema.String, type: Schema.String, title: Schema.String });
const Metadata = Schema.Struct({
	key: Schema.String,
	type: Schema.String,
	title: Schema.String,
	index: Schema.optional(Schema.Int),
	parentIndex: Schema.optional(Schema.Int),
	ratingKey: Schema.optional(Schema.String),
	Guid: Schema.optional(Schema.Array(Guid)),
	lastViewedAt: Schema.optional(Schema.Union(Schema.Int, Schema.String)),
});
const DirectoriesResponse = Schema.Struct({
	MediaContainer: Schema.Struct({
		Directory: Schema.optionalWith(Schema.Array(Directory), { default: () => [] }),
	}),
});
const MetadataResponse = Schema.Struct({
	MediaContainer: Schema.Struct({ Metadata: Schema.optional(Schema.Array(Metadata)) }),
});

const providerIds = (guids: ReadonlyArray<{ id: string }> | undefined) => {
	const get = (prefix: string) =>
		guids?.find(({ id }) => id.startsWith(`${prefix}://`))?.id.slice(prefix.length + 3);
	return { imdb: get("imdb"), tmdb: get("tmdb"), tvdb: get("tvdb") };
};

export const adaptPlexData = (
	input: { apiKey: string; apiUrl: string; allowInsecureConnections?: boolean | undefined },
	host: HttpHost,
) =>
	Effect.gen(function* () {
		const requestHost = withSourceRequestOptions(host, input.allowInsecureConnections);
		const headers = { Accept: "application/json", "X-Plex-Token": input.apiKey };
		const failures: MediaImportAdapterFailure[] = [];
		const groups = new Map<string, ImportMediaEntityGroupBuilder>();
		const root = yield* requestSourceJson(requestHost, {
			headers,
			baseUrl: input.apiUrl,
			path: "library/sections",
		}).pipe(Effect.flatMap(Schema.decodeUnknown(DirectoriesResponse)));
		let itemIndex = 0;
		for (const directory of root.MediaContainer.Directory) {
			if (directory.type !== "movie" && directory.type !== "show") {
				continue;
			}
			const section = yield* requestSourceJson(requestHost, {
				headers,
				baseUrl: input.apiUrl,
				query: { includeGuids: 1 },
				path: `library/sections/${directory.key}/all`,
			}).pipe(Effect.flatMap(Schema.decodeUnknown(MetadataResponse)));
			for (const item of section.MediaContainer.Metadata ?? []) {
				const currentIndex = itemIndex++;
				const occurredAt = parseDateInput(item.lastViewedAt, { unixSeconds: true });
				if (!occurredAt) {
					continue;
				}
				const entitySchemaSlug = directory.type === "movie" ? "movie" : "show";
				const ref = movieOrShowImportRef({
					entitySchemaSlug,
					sourceLabel: item.title,
					providerIds: providerIds(item.Guid),
				});
				if (!ref) {
					failures.push({
						itemIndex: currentIndex,
						sourceLabel: item.title,
						sourceIdentifier: item.key,
						stage: "input_transformation",
						message: "Plex item has no TMDB, TVDB, or IMDb identifier",
					});
					continue;
				}
				if (directory.type === "movie") {
					getOrCreateMediaEntityGroup(groups, ref, currentIndex).events.push(
						createCompleteEvent({ occurredAt, completedOn: occurredAt }),
					);
					continue;
				}
				if (!item.ratingKey) {
					failures.push({
						itemIndex: currentIndex,
						sourceLabel: item.title,
						sourceIdentifier: item.key,
						stage: "input_transformation",
						message: "Plex show has no rating key",
					});
					continue;
				}
				const leaves = yield* requestSourceJson(requestHost, {
					headers,
					baseUrl: input.apiUrl,
					path: `library/metadata/${item.ratingKey}/allLeaves`,
				}).pipe(Effect.flatMap(Schema.decodeUnknown(MetadataResponse)), Effect.either);
				if (Either.isLeft(leaves)) {
					failures.push(
						sourceFetchFailure({
							itemIndex: currentIndex,
							sourceLabel: item.title,
							sourceIdentifier: item.key,
							host: sourceApiHost(input.apiUrl),
							message: "Failed to fetch watched episodes from Plex",
						}),
					);
					continue;
				}
				const group = getOrCreateMediaEntityGroup(groups, ref, currentIndex);
				for (const leaf of leaves.right.MediaContainer.Metadata ?? []) {
					const leafOccurredAt = parseDateInput(leaf.lastViewedAt, { unixSeconds: true });
					if (!leafOccurredAt || leaf.parentIndex == null || leaf.index == null) {
						continue;
					}
					group.events.push({
						occurredAt: leafOccurredAt,
						eventSchemaSlug: "progress",
						properties: { progressPercent: 100 },
						episodeLocator: {
							type: "show",
							episodeNumber: leaf.index,
							seasonNumber: leaf.parentIndex,
						},
					});
				}
			}
		}
		return { failures, totalItems: itemIndex, entityGroups: finalizeEntityGroups(groups.values()) };
	});
