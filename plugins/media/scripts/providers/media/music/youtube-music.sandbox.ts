import { defineDriver, defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import {
	type UnknownRecord,
	asRecord,
	numberValue,
	stringValue,
} from "../../../script-helpers/records";
import { createRoleAccumulator } from "../../../script-helpers/role-accumulator";
import {
	coerceTrimmed,
	createYoutubeHistoryClient,
	createYoutubeMusicClient,
	getBestThumbnailUrl,
	getThumbnailUrls,
	type HistoryClient,
	type MusicSearchClient,
	type TrackQueueClient,
} from "../../youtube-music-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "YouTube Music",
	requiredAppConfigKeys: [],
	capabilities: ["httpCall"],
	slug: "music.youtube-music",
	providerInformation: { source: "youtube-music", canonicalLanguage: "en" },
});
const getTrackTitle = (track: UnknownRecord | null) => {
	const raw = asRecord(track?.["title"])?.["text"] ?? track?.["title"] ?? "";
	return coerceTrimmed(raw);
};
const nodeTitle = (value: unknown) => stringValue(asRecord(value)?.["text"]) ?? "N/A";
type SuggestionEntity = {
	name: string;
	externalId: string;
	scriptSlug: string;
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
			scriptSlug: "music.youtube-music",
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
							externalId: coerceTrimmed(id),
							calloutProperty: { kind: "null" as const, value: null },
							titleProperty: { kind: "text" as const, value: coerceTrimmed(title) },
							secondarySubtitleProperty: { kind: "null" as const, value: null },
							imageProperty:
								thumb === null
									? { kind: "null" as const, value: null }
									: { kind: "image" as const, value: { type: "remote" as const, url: thumb } },
							primarySubtitleProperty:
								year === null
									? { kind: "null" as const, value: null }
									: { kind: "number" as const, value: Number(year) },
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
						scriptSlug: "person.youtube-music",
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
						scriptSlug: "music-group.youtube-music",
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
								(entity) => entity.scriptSlug === "person.youtube-music",
							),
						},
						{
							direction: "incoming" as const,
							synchronization: "additive" as const,
							relationshipSchemaSlug: "music-group-to-music",
							entities: accumulator.entities.filter(
								(entity) => entity.scriptSlug === "music-group.youtube-music",
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
export const buildHistory = (client: HistoryClient, timezone: string) =>
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
					.format(new Date())
					.toLowerCase();
				return lower.includes(localDate);
			};
			const songs: {
				videoId: string;
				title: string;
			}[] = [];
			const sections = asRecord(history)?.["sections"];
			for (const section of Array.isArray(sections) ? sections : []) {
				const sectionRecord = asRecord(section);
				const header = asRecord(sectionRecord?.["header"]);
				if (header?.["type"] !== "ItemSectionHeader") {
					continue;
				}
				if (!isTodayHeader(nodeTitle(header["title"]))) {
					continue;
				}
				const contents = sectionRecord?.["contents"];
				for (const node of Array.isArray(contents) ? contents : []) {
					const nodeRecord = asRecord(node);
					if (nodeRecord?.["type"] !== "Video") {
						continue;
					}
					const videoId = stringValue(nodeRecord["video_id"]);
					if (videoId) {
						songs.push({ videoId, title: nodeTitle(nodeRecord["title"]) });
					}
				}
				break;
			}
			return { songs };
		}),
	);
export const search = defineProviderDriver(manifest, "search", (input, host) =>
	createYoutubeMusicClient(host).pipe(
		Effect.flatMap((client) => buildTrackSearch(client, input.query, input.pageSize)),
	),
);
export const details = defineProviderDriver(manifest, "details", (input, host) =>
	createYoutubeMusicClient(host, manifest.providerInformation.canonicalLanguage).pipe(
		Effect.flatMap((client) => buildTrackDetails(client, input.externalId)),
	),
);
export const translate = defineProviderDriver(manifest, "translate", (input, host) =>
	createYoutubeMusicClient(host, input.language).pipe(
		Effect.flatMap((client) => buildTrackTranslate(client, input.externalId)),
	),
);
export const history = defineDriver(manifest, {
	input: Schema.Struct({
		timezone: Schema.Trim.pipe(Schema.minLength(1, { message: () => "timezone is required" })),
		authCookie: Schema.Trim.pipe(Schema.minLength(1, { message: () => "authCookie is required" })),
	}),
	output: Schema.Struct({
		songs: Schema.Array(Schema.Struct({ title: Schema.String, videoId: Schema.String })),
	}),
	run: (input, host) =>
		createYoutubeHistoryClient(host, input.authCookie).pipe(
			Effect.flatMap((client) => buildHistory(client, input.timezone)),
		),
});
export default defineProvider({ manifest, drivers: { search, details, translate, history } });
