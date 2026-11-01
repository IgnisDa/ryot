import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { asArray, asRecord } from "@ryot-app/plugin-backend-sdk/wire";

import { normalizePlainDescription } from "../../../lib/plain-description";
import { stringValue, type UnknownRecord } from "../../../lib/records";
import { createRoleAccumulator } from "../../../lib/role-accumulator";
import {
	type ArtistClient,
	coerceTrimmed,
	getBestThumbnailUrl,
	getThumbnailUrls,
	type MusicSearchClient,
	tryYoutubeMusic,
} from "../../../lib/vendors/youtube-music";

const getArtistName = (artist: null | UnknownRecord) => {
	const raw = asRecord(asRecord(artist?.["header"])?.["title"])?.["text"] ?? artist?.["name"] ?? "";
	return coerceTrimmed(raw);
};

const collectArtistEntities = (artist: null | UnknownRecord) => {
	const media = createRoleAccumulator();
	const groups = createRoleAccumulator();
	for (const section of asArray(artist?.["sections"])) {
		for (const item of asArray(asRecord(section)?.["contents"])) {
			const itemRecord = asRecord(item);
			const itemType = itemRecord?.["item_type"];
			if (itemType !== "album" && itemType !== "song" && itemType !== "video") {
				continue;
			}
			const id = stringValue(itemRecord?.["id"]);
			const title =
				stringValue(itemRecord?.["title"]) ??
				stringValue(asRecord(itemRecord?.["title"])?.["text"]);
			if (!id || !title) {
				continue;
			}
			const isAlbum = itemType === "album";
			const accumulator = isAlbum ? groups : media;
			accumulator.add({
				name: title,
				externalId: id,
				relationshipProperties: { roles: ["Artist"] },
				providerSlug: isAlbum ? "music-group.youtube-music" : "music.youtube-music",
			});
		}
	}
	return { media: media.entities, groups: groups.entities };
};

export const buildArtistSearch = (client: MusicSearchClient, query: string) =>
	tryYoutubeMusic(() => client.music.search(query, { type: "artist" })).pipe(
		Effect.map((results) => {
			const shelves = asRecord(results)?.["contents"];
			const items = asArray(shelves).flatMap((shelf) => {
				const artists = asRecord(shelf)?.["contents"];
				return asArray(artists).flatMap((artist) => {
					const record = asRecord(artist);
					const id = record?.["id"];
					if (!id) {
						return [];
					}
					const name = record["name"] ?? record["title"] ?? id;
					const thumb = getBestThumbnailUrl(record["thumbnail"]);
					return [
						{
							title: coerceTrimmed(name),
							externalId: coerceTrimmed(id),
							...(thumb === null ? {} : { imageUrl: thumb }),
						},
					];
				});
			});
			return { items, details: { nextPage: null, totalItems: items.length } };
		}),
	);

export const buildArtistDetails = (client: ArtistClient, externalId: string) =>
	tryYoutubeMusic(() => client.music.getArtist(externalId)).pipe(
		Effect.map((artist) => {
			const artistRecord = asRecord(artist);
			const name = getArtistName(artistRecord);
			if (!name) {
				throw new Error("YouTube Music artist is missing name");
			}

			const header = asRecord(artistRecord?.["header"]);
			const descriptionValue = asRecord(header?.["description"])?.["text"];
			const description = normalizePlainDescription(descriptionValue);
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
						purpose: "profile" as const,
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
	tryYoutubeMusic(() => client.music.getArtist(externalId)).pipe(
		Effect.map((artist) => {
			const name = getArtistName(asRecord(artist));
			return name ? { name } : {};
		}),
	);
