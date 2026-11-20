import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { readMediaCapture } from "../../imports/collection";
import type { MediaIntegrationAdapterResult } from "../../imports/schemas";
import { movieOrShowImportRef, sourceFetchFailure } from "../../imports/source-helpers";
import { captureIntegrationWindow } from "../artifacts";
import type { YankInput } from "../schemas";
import { baseUrl, requestJson } from "../shared";
import { technicalCopyDetails } from "./technical-details";

const Stream = Schema.Struct({
	Type: Schema.String,
	Width: Schema.optional(Schema.Finite),
	Codec: Schema.optional(Schema.String),
	Title: Schema.optional(Schema.String),
	Height: Schema.optional(Schema.Finite),
	Profile: Schema.optional(Schema.String),
	BitRate: Schema.optional(Schema.Finite),
	Channels: Schema.optional(Schema.Finite),
	IsDefault: Schema.optional(Schema.Boolean),
	IsInterlaced: Schema.optional(Schema.Boolean),
	ChannelLayout: Schema.optional(Schema.String),
	VideoRangeType: Schema.optional(Schema.String),
	ExtendedVideoType: Schema.optional(Schema.String),
	AudioSpatialFormat: Schema.optional(Schema.String),
});

const MediaVersion = Schema.Struct({
	Id: Schema.NonEmptyString,
	DateCreated: Schema.optional(Schema.String),
	MediaStreams: Schema.optional(Schema.Array(Stream)),
	Video3DFormat: Schema.optional(Schema.NullOr(Schema.String)),
});

const Title = Schema.Struct({
	Name: Schema.String,
	ProviderIds: Schema.optional(Schema.Record(Schema.String, Schema.NullOr(Schema.String))),
});

const Item = Schema.Struct({
	...Title.fields,
	Id: Schema.NonEmptyString,
	SeriesId: Schema.optional(Schema.String),
	IndexNumber: Schema.optional(Schema.Int),
	Type: Schema.Literals(["Episode", "Movie"]),
	DateCreated: Schema.optional(Schema.String),
	ParentIndexNumber: Schema.optional(Schema.Int),
	MediaSources: Schema.optional(Schema.Array(MediaVersion)),
	Video3DFormat: Schema.optional(Schema.NullOr(Schema.String)),
});

const Listing = Schema.Struct({ Items: Schema.Array(Item), TotalRecordCount: Schema.Int });

const Cursor = Schema.fromJsonString(Schema.Struct({ total: Schema.Int, offset: Schema.Int }));

export const scanMediaServer = Effect.fn(function* (
	source: "emby" | "jellyfin",
	input: typeof YankInput.Type,
	host: ScriptHost,
) {
	if (input.ingestionConfirmation) {
		return { chunkFiles: [], carryFile: null };
	}
	const { providerSpecifics: settings } = yield* host.getCurrentIntegration();
	const apiKey = yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)(settings["apiKey"]);
	const userId = yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)(settings["userId"]);
	const url = baseUrl(settings["baseUrl"]);
	const headers: Record<string, string> =
		source === "jellyfin"
			? { Accept: "application/json", Authorization: `MediaBrowser Token="${apiKey}"` }
			: { "X-Emby-Token": apiKey, Accept: "application/json" };
	const cursor = input.ingestionArtifacts
		? yield* Schema.decodeEffect(Cursor)(new TextDecoder().decode(yield* readMediaCapture("carry")))
		: null;
	const offset = cursor?.offset ?? 0;
	const query = new URLSearchParams({
		Limit: "25",
		UserId: userId,
		Recursive: "true",
		SortBy: "SortName",
		StartIndex: String(offset),
		EnableTotalRecordCount: "true",
		IncludeItemTypes: "Movie,Episode",
		Fields: "ProviderIds,MediaSources,MediaStreams,DateCreated",
	});
	const listing = yield* requestJson(host, "GET", `${url}/Items?${query}`, { headers }).pipe(
		Effect.flatMap(Schema.decodeUnknownEffect(Listing)),
	);
	const groups: MediaIntegrationAdapterResult["entityGroups"][number][] = [];
	const failures: MediaIntegrationAdapterResult["failures"][number][] = [];
	const seriesById = new Map<string, typeof Title.Type>();
	for (const [index, item] of listing.Items.entries()) {
		const itemIndex = offset + index;
		const episode = item.Type === "Episode";
		let title: undefined | typeof Title.Type = item;
		if (episode) {
			title = undefined;
			if (item.SeriesId !== undefined) {
				title = seriesById.get(item.SeriesId);
				if (title === undefined) {
					const itemId = encodeURIComponent(item.SeriesId);
					const viewer = encodeURIComponent(userId);
					const seriesPath =
						source === "jellyfin"
							? `/Items/${itemId}?UserId=${viewer}`
							: `/Users/${viewer}/Items/${itemId}`;
					const series = yield* requestJson(host, "GET", `${url}${seriesPath}`, { headers }).pipe(
						Effect.flatMap(Schema.decodeUnknownEffect(Title)),
						Effect.result,
					);
					if (series._tag === "Success") {
						title = series.success;
						seriesById.set(item.SeriesId, title);
					}
				}
			}
		}
		const ids = title?.ProviderIds;
		const ref =
			title === undefined
				? null
				: movieOrShowImportRef({
						sourceLabel: title.Name,
						entitySchemaSlug: episode ? "show" : "movie",
						providerIds: {
							imdb: ids?.["Imdb"] ?? undefined,
							tmdb: ids?.["Tmdb"] ?? undefined,
							tvdb: ids?.["Tvdb"] ?? undefined,
						},
					});
		const coordinates =
			item.IndexNumber !== undefined && item.ParentIndexNumber !== undefined
				? {
						type: "show" as const,
						episodeNumber: item.IndexNumber,
						seasonNumber: item.ParentIndexNumber,
					}
				: undefined;
		if (!ref || (episode && coordinates === undefined) || !item.MediaSources?.length) {
			failures.push({
				itemIndex,
				sourceLabel: item.Name,
				sourceIdentifier: item.Id,
				stage: "input_transformation",
				message: "Inventory item is missing a media match, episode coordinates, or media versions",
			});
			continue;
		}
		groups.push({
			itemIndex,
			events: [],
			entityRef: ref,
			collectionMemberships: [],
			copies: item.MediaSources.map((version) => {
				const streams = version.MediaStreams ?? [];
				const videos = streams.filter(({ Type }) => Type === "Video");
				const track = videos.find(({ IsDefault }) => IsDefault) ?? videos[0];
				const format3d = version.Video3DFormat ?? item.Video3DFormat;
				return {
					source,
					sourceId: JSON.stringify([item.Id, version.Id]),
					unresolvedEpisode: episode ? coordinates : undefined,
					details: technicalCopyDetails({
						is3d: format3d === undefined ? undefined : format3d !== null && format3d !== "None",
						addedAt:
							version.DateCreated ??
							(item.MediaSources?.length === 1 ? item.DateCreated : undefined),
						video: track
							? {
									width: track.Width,
									height: track.Height,
									interlaced: track.IsInterlaced,
									range: track.VideoRangeType ?? track.ExtendedVideoType,
								}
							: undefined,
						audio: streams
							.filter(({ Type }) => Type === "Audio")
							.map((audio) => ({
								codec: audio.Codec,
								title: audio.Title,
								profile: audio.Profile,
								bitrate: audio.BitRate,
								channels: audio.Channels,
								layout: audio.ChannelLayout,
								spatial: audio.AudioSpatialFormat,
							})),
					}),
				};
			}),
		});
	}
	const total = listing.TotalRecordCount;
	const next = offset + listing.Items.length;
	if (
		(cursor !== null && cursor.total !== total) ||
		next > total ||
		(listing.Items.length === 0 && offset < total)
	) {
		failures.push(
			sourceFetchFailure({ itemIndex: next, message: "Inventory changed during paging" }),
		);
		return yield* captureIntegrationWindow(source, { failures, entityGroups: groups }, null);
	}
	return yield* captureIntegrationWindow(
		source,
		{ failures, entityGroups: groups },
		next < total ? yield* Schema.encodeEffect(Cursor)({ total, offset: next }) : null,
	);
});
