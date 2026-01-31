import { defineManifest } from "@ryot/sandbox-sdk";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import { asRecord, numberValue, stringValue, trimmedString } from "../../script-helpers/records";
import {
	getFirstImage,
	getImagesSortedBySize,
	type SpotifyHost,
	spotifyGet,
} from "../spotify-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Spotify",
	slug: "person.spotify",
	providerInformation: { source: "spotify" },
	capabilities: ["httpCall", "getAppConfigValue", "getCachedValue", "setCachedValue"],
	requiredAppConfigKeys: ["music.spotifyClientId", "music.spotifyClientSecret"],
});

const PAGE_SIZE = 20;
const ALBUM_PAGE_LIMIT = 50;

export const search = defineProviderDriver(manifest, "search", (input, host) => {
	const offset = (input.page - 1) * PAGE_SIZE;
	return spotifyGet(host, "/search", {
		type: "artist",
		q: input.query,
		offset: String(offset),
		limit: String(PAGE_SIZE),
	}).then((dataValue) => {
		const artists = asRecord(asRecord(dataValue)?.["artists"]);
		const totalItems = numberValue(artists?.["total"]) ?? 0;
		const artistItems = Array.isArray(artists?.["items"]) ? artists["items"] : [];
		const items = artistItems.flatMap((artist) => {
			const record = asRecord(artist);
			const externalId = stringValue(record?.["id"]);
			if (!externalId) {
				return [];
			}
			const name = stringValue(record?.["name"]) ?? externalId;
			const imageUrl = getFirstImage(record?.["images"]);
			return [
				{
					externalId,
					titleProperty: { kind: "text" as const, value: name },
					calloutProperty: { kind: "null" as const, value: null },
					primarySubtitleProperty: { kind: "null" as const, value: null },
					secondarySubtitleProperty: { kind: "null" as const, value: null },
					imageProperty:
						imageUrl === null
							? { kind: "null" as const, value: null }
							: { kind: "image" as const, value: { type: "remote" as const, url: imageUrl } },
				},
			];
		});
		return {
			items,
			details: {
				totalItems,
				nextPage: offset + artistItems.length < totalItems ? input.page + 1 : null,
			},
		};
	});
});

const fetchArtistAlbums = (
	host: SpotifyHost,
	externalId: string,
	offset: number,
	collected: readonly unknown[],
): Promise<readonly unknown[]> =>
	spotifyGet(host, `/artists/${encodeURIComponent(externalId)}/albums`, {
		include_groups: "album,single",
		offset: String(offset),
		limit: String(ALBUM_PAGE_LIMIT),
	}).then((dataValue) => {
		const data = asRecord(dataValue);
		const items = Array.isArray(data?.["items"]) ? data["items"] : [];
		if (items.length === 0) {
			return collected;
		}
		const next = [...collected, ...items];
		const total = numberValue(data?.["total"]) ?? 0;
		if (next.length >= total) {
			return next;
		}
		return fetchArtistAlbums(host, externalId, offset + ALBUM_PAGE_LIMIT, next);
	});

export const details = defineProviderDriver(manifest, "details", (input, host) =>
	spotifyGet(host, `/artists/${encodeURIComponent(input.externalId)}`).then((artistValue) => {
		const artist = asRecord(artistValue);
		const name = stringValue(artist?.["name"]);
		if (!name) {
			throw new Error("Spotify artist is missing name");
		}

		const genres = Array.isArray(artist?.["genres"])
			? artist["genres"].flatMap((genre) => (typeof genre === "string" ? [genre] : []))
			: [];
		const description = genres.length > 0 ? `Genres: ${genres.join(", ")}` : null;
		const sourceUrl = stringValue(asRecord(artist?.["external_urls"])?.["spotify"]);

		return fetchArtistAlbums(host, input.externalId, 0, []).then((albums) => {
			const groupEntities = albums.map((album) => {
				const record = asRecord(album);
				const albumId = trimmedString(record?.["id"]);
				const albumName = trimmedString(record?.["name"]);
				return {
					externalId: albumId,
					scriptSlug: "music-group.spotify",
					relationshipProperties: { roles: ["Artist"] },
					name: albumName.length > 0 ? albumName : albumId,
				};
			});
			return spotifyGet(host, `/artists/${encodeURIComponent(input.externalId)}/top-tracks`, {
				market: "US",
			}).then((topTracksValue) => {
				const tracks = asRecord(topTracksValue)?.["tracks"];
				const mediaEntities = (Array.isArray(tracks) ? tracks : []).flatMap((track) => {
					const record = asRecord(track);
					const trackId = trimmedString(record?.["id"]);
					if (!trackId) {
						return [];
					}
					const trackName = trimmedString(record?.["name"]);
					return [
						{
							externalId: trackId,
							scriptSlug: "music.spotify",
							relationshipProperties: { roles: ["Artist"] },
							name: trackName.length > 0 ? trackName : trackId,
						},
					];
				});
				return {
					name,
					relatedEntityGroups: [
						{
							direction: "outgoing" as const,
							entities: mediaEntities,
							synchronization: "authoritative" as const,
							relationshipSchemaSlug: "person-to-music",
						},
						{
							direction: "outgoing" as const,
							entities: groupEntities,
							synchronization: "authoritative" as const,
							relationshipSchemaSlug: "person-to-music-group",
						},
					],
					properties: {
						sourceUrl,
						description,
						alternateNames: [],
						images: getImagesSortedBySize(artist?.["images"]).map((url) => ({
							url,
							type: "remote" as const,
						})),
					},
				};
			});
		});
	}),
);

export default defineProvider({ manifest, drivers: { search, details } });
