import { defineManifest } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import { type UnknownRecord, asRecord, stringValue } from "../../script-helpers/records";
import {
	type ArtistClient,
	coerceTrimmed,
	createYoutubeMusicClient,
	getBestThumbnailUrl,
	getThumbnailUrls,
	type MusicSearchClient,
} from "../youtube-music-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "YouTube Music",
	slug: "person.youtube-music",
	requiredAppConfigKeys: [],
	capabilities: ["httpCall"],
	providerInformation: { source: "youtube-music", canonicalLanguage: "en" },
});

type ArtistRelatedEntity = {
	name: string;
	externalId: string;
	scriptSlug: string;
	relationshipProperties: { roles: string[] };
};

const getArtistName = (artist: UnknownRecord | null) => {
	const raw = asRecord(asRecord(artist?.["header"])?.["title"])?.["text"] ?? artist?.["name"] ?? "";
	return coerceTrimmed(raw);
};

const collectArtistEntities = (artist: UnknownRecord | null) => {
	const media: ArtistRelatedEntity[] = [];
	const groups: ArtistRelatedEntity[] = [];
	const sections = artist?.["sections"];
	for (const section of Array.isArray(sections) ? sections : []) {
		const record = asRecord(section);
		const rawSectionTitle =
			asRecord(record?.["title"])?.["text"] ??
			asRecord(asRecord(record?.["header"])?.["title"])?.["text"] ??
			record?.["title"] ??
			"";
		const sectionTitle = coerceTrimmed(rawSectionTitle).toLowerCase();
		const isTrackSection = /song|track|video/.test(sectionTitle);
		const contents = record?.["contents"];
		for (const item of Array.isArray(contents) ? contents : []) {
			const itemRecord = asRecord(item);
			const videoId = stringValue(itemRecord?.["video_id"]);
			const id = videoId ?? stringValue(itemRecord?.["id"]);
			const title = stringValue(itemRecord?.["title"]) ?? stringValue(itemRecord?.["name"]);
			if (!id || !title) {
				continue;
			}
			if (videoId || isTrackSection) {
				media.push({
					name: title,
					externalId: id,
					scriptSlug: "music.youtube-music",
					relationshipProperties: { roles: ["Artist"] },
				});
			} else {
				groups.push({
					name: title,
					externalId: id,
					scriptSlug: "music-group.youtube-music",
					relationshipProperties: { roles: ["Artist"] },
				});
			}
		}
	}
	return { media, groups };
};

export const buildArtistSearch = (client: MusicSearchClient, query: string) =>
	Effect.tryPromise(() => client.music.search(query, { type: "artist" })).pipe(
		Effect.map((results) => {
			const shelves = asRecord(results)?.["contents"];
			const items = (Array.isArray(shelves) ? shelves : []).flatMap((shelf) => {
				const artists = asRecord(shelf)?.["contents"];
				return (Array.isArray(artists) ? artists : []).flatMap((artist) => {
					const record = asRecord(artist);
					const id = record?.["id"];
					if (!id) {
						return [];
					}
					const name = record["name"] ?? record["title"] ?? id;
					const thumb = getBestThumbnailUrl(record["thumbnail"]);
					return [
						{
							externalId: coerceTrimmed(id),
							calloutProperty: { kind: "null" as const, value: null },
							titleProperty: { kind: "text" as const, value: coerceTrimmed(name) },
							primarySubtitleProperty: { kind: "null" as const, value: null },
							secondarySubtitleProperty: { kind: "null" as const, value: null },
							imageProperty:
								thumb === null
									? { kind: "null" as const, value: null }
									: { kind: "image" as const, value: { type: "remote" as const, url: thumb } },
						},
					];
				});
			});
			return { items, details: { totalItems: items.length, nextPage: null } };
		}),
	);

export const buildArtistDetails = (client: ArtistClient, externalId: string) =>
	Effect.tryPromise(() => client.music.getArtist(externalId)).pipe(
		Effect.map((artist) => {
			const artistRecord = asRecord(artist);
			const name = getArtistName(artistRecord);
			if (!name) {
				throw new Error("YouTube Music artist is missing name");
			}

			const header = asRecord(artistRecord?.["header"]);
			const descriptionValue = asRecord(header?.["description"])?.["text"];
			const description = typeof descriptionValue === "string" ? descriptionValue : null;

			const { media, groups } = collectArtistEntities(artistRecord);

			return {
				name,
				properties: {
					description,
					alternateNames: [],
					sourceUrl: `https://music.youtube.com/channel/${externalId}`,
					images: getThumbnailUrls(header?.["thumbnail"]).map((url) => ({
						url,
						type: "remote" as const,
					})),
				},
				relatedEntityGroups: [
					{
						entities: media,
						direction: "outgoing" as const,
						synchronization: "authoritative" as const,
						relationshipSchemaSlug: "person-to-music",
					},
					{
						entities: groups,
						direction: "outgoing" as const,
						synchronization: "authoritative" as const,
						relationshipSchemaSlug: "person-to-music-group",
					},
				],
			};
		}),
	);

export const buildArtistTranslate = (client: ArtistClient, externalId: string) =>
	Effect.tryPromise(() => client.music.getArtist(externalId)).pipe(
		Effect.map((artist) => {
			const name = getArtistName(asRecord(artist));
			return name ? { name } : {};
		}),
	);

export const search = defineProviderDriver(manifest, "search", (input, host) =>
	createYoutubeMusicClient(host).pipe(
		Effect.flatMap((client) => buildArtistSearch(client, input.query)),
	),
);

export const details = defineProviderDriver(manifest, "details", (input, host) =>
	createYoutubeMusicClient(host, manifest.providerInformation.canonicalLanguage).pipe(
		Effect.flatMap((client) => buildArtistDetails(client, input.externalId)),
	),
);

export const translate = defineProviderDriver(manifest, "translate", (input, host) =>
	createYoutubeMusicClient(host, input.language).pipe(
		Effect.flatMap((client) => buildArtistTranslate(client, input.externalId)),
	),
);

export default defineProvider({ manifest, drivers: { search, details, translate } });
