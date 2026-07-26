import { Effect } from "@ryot/sandbox-sdk/effect";

import { type UnknownRecord, asRecord, numberValue, stringValue } from "../../../../shared/records";
import { createRoleAccumulator } from "../../../../shared/role-accumulator";
import {
	coerceTrimmed,
	getBestThumbnailUrl,
	getThumbnailUrls,
	type HistoryClient,
	type MusicSearchClient,
	type TrackQueueClient,
} from "../../youtube-music-shared";

const getTrackTitle = (track: UnknownRecord | null) => {
	const raw = asRecord(track?.["title"])?.["text"] ?? track?.["title"] ?? "";
	return coerceTrimmed(raw);
};

const nodeTitle = (value: unknown) => {
	const record = asRecord(value);
	const text = stringValue(record?.["text"]) ?? stringValue(record?.["simpleText"]);
	if (text) {
		return text;
	}
	const runs = record?.["runs"];
	return (
		(Array.isArray(runs) ? runs : [])
			.map((run) => stringValue(asRecord(run)?.["text"]) ?? "")
			.join("")
			.trim() || "N/A"
	);
};

type SuggestionEntity = {
	name: string;
	externalId: string;
	providerSlug: string;
};

const collectSuggestions = (
	contents: readonly unknown[],
	externalId: string,
): SuggestionEntity[] => {
	const byKey = new Map<string, SuggestionEntity>();
	for (const item of contents) {
		const record = asRecord(item);
		const suggestionId = stringValue(record?.["video_id"]);
		if (!suggestionId || suggestionId === externalId) {
			continue;
		}
		const name = getTrackTitle(record);
		if (!name) {
			continue;
		}
		byKey.set(`music.youtube-music:${suggestionId}`, {
			name,
			externalId: suggestionId,
			providerSlug: "music.youtube-music",
		});
	}
	return [...byKey.values()];
};

export const buildTrackSearch = (client: MusicSearchClient, query: string, pageSize: number) =>
	Effect.tryPromise(() => client.music.search(query, { type: "song" })).pipe(
		Effect.map((results) => {
			const shelves = asRecord(results)?.["contents"];
			const allItems = (Array.isArray(shelves) ? shelves : []).flatMap((shelf) => {
				const tracks = asRecord(shelf)?.["contents"];
				return (Array.isArray(tracks) ? tracks : []).flatMap((track) => {
					const record = asRecord(track);
					const id = record?.["id"];
					if (!id) {
						return [];
					}
					const title = record["title"] ?? id;
					const year = record["year"] ?? null;
					const thumb = getBestThumbnailUrl(record["thumbnail"]);
					return [
						{
							title: coerceTrimmed(title),
							externalId: coerceTrimmed(id),
							...(thumb === null ? {} : { imageUrl: thumb }),
							...(year === null ? {} : { metadata: [Number(year)] as const }),
						},
					];
				});
			});
			const items = allItems.slice(0, pageSize);
			return { items, details: { totalItems: items.length, nextPage: null } };
		}),
	);

export const buildTrackDetails = (client: TrackQueueClient, externalId: string) =>
	Effect.tryPromise(() => client.music.getUpNext(externalId)).pipe(
		Effect.flatMap((queue) =>
			Effect.gen(function* () {
				const rawContents = asRecord(queue)?.["contents"];
				const contents = Array.isArray(rawContents) ? rawContents : [];
				const trackItem =
					contents.find((item) => asRecord(item)?.["video_id"] === externalId) ?? contents[0];
				const trackRecord = asRecord(trackItem);
				if (!trackRecord) {
					return yield* Effect.fail(new Error(`YouTube Music track not found: ${externalId}`));
				}
				const title = getTrackTitle(trackRecord);
				if (!title) {
					return yield* Effect.fail(new Error("YouTube Music track is missing title"));
				}
				const duration = numberValue(asRecord(trackRecord["duration"])?.["seconds"]);
				const album = asRecord(trackRecord["album"]);
				const albumYear = album?.["year"];
				const publishYear = albumYear
					? Number.parseInt(coerceTrimmed(albumYear), 10) || null
					: null;
				const accumulator = createRoleAccumulator();
				const artists = trackRecord["artists"];
				for (const artist of Array.isArray(artists) ? artists : []) {
					const artistRecord = asRecord(artist);
					const artistId = stringValue(artistRecord?.["channel_id"]);
					if (!artistId) {
						continue;
					}
					accumulator.add({
						externalId: artistId,
						providerSlug: "person.youtube-music",
						name: stringValue(artistRecord?.["name"]) ?? "Loading...",
						relationshipProperties: { roles: ["Artist"] },
					});
				}
				const artistCount = accumulator.entities.length;
				const byVariousArtists = artistCount === 0 ? null : artistCount > 1;
				const albumId = stringValue(album?.["id"]);
				const albumName = stringValue(album?.["name"]);
				if (album && albumId && albumName) {
					accumulator.add({
						name: albumName,
						externalId: albumId,
						providerSlug: "music-group.youtube-music",
						relationshipProperties: { roles: ["Member"] },
					});
				}
				const suggestions = collectSuggestions(contents, externalId);
				return {
					name: title,
					relatedEntityGroups: [
						{
							direction: "incoming" as const,
							synchronization: "additive" as const,
							relationshipSchemaSlug: "person-to-music",
							entities: accumulator.entities.filter(
								(entity) => entity.providerSlug === "person.youtube-music",
							),
						},
						{
							direction: "incoming" as const,
							synchronization: "additive" as const,
							relationshipSchemaSlug: "music-group-to-music",
							entities: accumulator.entities.filter(
								(entity) => entity.providerSlug === "music-group.youtube-music",
							),
						},
						{
							entities: suggestions,
							direction: "outgoing" as const,
							synchronization: "authoritative" as const,
							relationshipSchemaSlug: "media-suggestion",
						},
					],
					properties: {
						genres: [],
						publishYear,
						byVariousArtists,
						duration: duration ?? null,
						sourceUrl: `https://music.youtube.com/watch?v=${externalId}`,
						images: getThumbnailUrls(trackRecord["thumbnail"]).map((url) => ({
							url,
							type: "remote" as const,
							purpose: "cover" as const,
						})),
					},
				};
			}),
		),
	);

export const buildTrackTranslate = (client: TrackQueueClient, externalId: string) =>
	Effect.tryPromise(() => client.music.getUpNext(externalId)).pipe(
		Effect.flatMap((queue) =>
			Effect.gen(function* () {
				const rawContents = asRecord(queue)?.["contents"];
				const contents = Array.isArray(rawContents) ? rawContents : [];
				const trackRecord = asRecord(
					contents.find((item) => asRecord(item)?.["video_id"] === externalId),
				);
				if (!trackRecord) {
					return yield* Effect.fail(new Error(`YouTube Music track not found: ${externalId}`));
				}
				const name = getTrackTitle(trackRecord);
				return name ? { name } : {};
			}),
		),
	);

export const buildHistory = (client: HistoryClient, timezone: string, startedAt: string) =>
	Effect.tryPromise(() => client.getHistory()).pipe(
		Effect.map((history) => {
			const isTodayHeader = (title: string) => {
				const lower = title.toLowerCase();
				if (lower === "today") {
					return true;
				}
				const localDate = new Intl.DateTimeFormat("en-US", {
					month: "long",
					day: "numeric",
					year: "numeric",
					timeZone: timezone,
				})
					.format(new Date(startedAt))
					.toLowerCase();
				return lower.includes(localDate);
			};
			const songs: { videoId: string; title: string }[] = [];
			const rootContents = asRecord(asRecord(history)?.["contents"]);
			const browseResults = asRecord(rootContents?.["singleColumnBrowseResultsRenderer"]);
			const tabs = browseResults?.["tabs"];
			const tab = asRecord(Array.isArray(tabs) ? tabs[0] : null);
			const tabContent = asRecord(asRecord(tab?.["tabRenderer"])?.["content"]);
			const sections = asRecord(tabContent?.["sectionListRenderer"])?.["contents"];
			for (const section of Array.isArray(sections) ? sections : []) {
				const shelf = asRecord(asRecord(section)?.["musicShelfRenderer"]);
				if (!shelf || !isTodayHeader(nodeTitle(shelf["title"]))) {
					continue;
				}
				const contents = shelf["contents"];
				for (const node of Array.isArray(contents) ? contents : []) {
					const item = asRecord(asRecord(node)?.["musicResponsiveListItemRenderer"]);
					if (!item) {
						continue;
					}
					const videoId = stringValue(asRecord(item["playlistItemData"])?.["videoId"]);
					if (videoId) {
						const columns = item["flexColumns"];
						const firstColumn = asRecord(Array.isArray(columns) ? columns[0] : null);
						const column = asRecord(firstColumn?.["musicResponsiveListItemFlexColumnRenderer"]);
						songs.push({ videoId, title: nodeTitle(column?.["text"]) });
					}
				}
				break;
			}
			return { songs };
		}),
	);
