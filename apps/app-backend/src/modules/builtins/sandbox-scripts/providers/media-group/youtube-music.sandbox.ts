import { defineManifest } from "@ryot/sandbox-sdk";
import { load } from "@ryot/sandbox-sdk/cheerio";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import {
	type AlbumClient,
	asRecord,
	coerceTrimmed,
	createYoutubeMusicClient,
	getBestThumbnailUrl,
	type MusicSearchClient,
	stringValue,
	type UnknownRecord,
} from "../youtube-music-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "YouTube Music",
	slug: "music-group.youtube-music",
	requiredAppConfigKeys: [],
	capabilities: ["httpCall"],
	providerInformation: { source: "youtube-music", canonicalLanguage: "en" },
});

const getAlbumTitle = (album: UnknownRecord | null) => {
	const raw = album?.["title"] ?? asRecord(asRecord(album?.["header"])?.["title"])?.["text"] ?? "";
	return coerceTrimmed(raw);
};

export const buildAlbumSearch = (client: MusicSearchClient, query: string, pageSize: number) =>
	client.music.search(query, { type: "album" }).then((results) => {
		const shelves = asRecord(results)?.["contents"];
		const allItems = (Array.isArray(shelves) ? shelves : []).flatMap((shelf) => {
			const albums = asRecord(shelf)?.["contents"];
			return (Array.isArray(albums) ? albums : []).flatMap((album) => {
				const record = asRecord(album);
				const id = record?.["id"];
				if (!id) {
					return [];
				}
				const name = record["title"] ?? id;
				const imageUrl = getBestThumbnailUrl(record["thumbnail"]);
				return [
					{
						externalId: coerceTrimmed(id),
						calloutProperty: { kind: "null" as const, value: null },
						titleProperty: { kind: "text" as const, value: coerceTrimmed(name) },
						primarySubtitleProperty: { kind: "null" as const, value: null },
						secondarySubtitleProperty: { kind: "null" as const, value: null },
						imageProperty:
							imageUrl === null
								? { kind: "null" as const, value: null }
								: { kind: "image" as const, value: { type: "remote" as const, url: imageUrl } },
					},
				];
			});
		});
		const items = allItems.slice(0, pageSize);
		return { items, details: { totalItems: 100, nextPage: null } };
	});

export const buildAlbumDetails = (client: AlbumClient, externalId: string) =>
	client.music.getAlbum(externalId).then((album) => {
		const albumRecord = asRecord(album);
		const title = getAlbumTitle(albumRecord);
		if (!title) {
			throw new Error(`YouTube Music album not found: ${externalId}`);
		}

		const headerRecord = asRecord(albumRecord?.["header"]);
		const rawDescription =
			albumRecord?.["description"] ?? asRecord(headerRecord?.["description"])?.["text"] ?? null;
		let description: string | null = null;
		if (rawDescription !== null) {
			const $ = load(coerceTrimmed(rawDescription));
			$("br").replaceWith("\n");
			description = $.root().text().trim();
		}

		const rawTracks = albumRecord?.["contents"];
		const tracks = Array.isArray(rawTracks) ? rawTracks : [];
		const parts = tracks.length > 0 ? tracks.length : null;

		const relatedEntities = tracks.flatMap((track, index) => {
			const trackRecord = asRecord(track);
			const memberId = stringValue(trackRecord?.["id"]);
			if (!memberId) {
				return [];
			}
			const memberName =
				stringValue(trackRecord?.["title"]) ??
				stringValue(asRecord(trackRecord?.["info"])?.["title"]) ??
				"Loading...";
			return [
				{
					name: memberName,
					externalId: memberId,
					scriptSlug: "music.youtube-music",
					relationshipProperties: { order: index + 1 },
				},
			];
		});

		const coverUrl = getBestThumbnailUrl(albumRecord?.["thumbnail"] ?? headerRecord?.["thumbnail"]);
		const images = coverUrl ? [{ type: "remote" as const, url: coverUrl }] : [];

		const playlistIdValue = albumRecord?.["playlist_id"];
		const playlistId = typeof playlistIdValue === "string" ? playlistIdValue : null;
		const sourceUrl = playlistId ? `https://music.youtube.com/playlist?list=${playlistId}` : null;

		return {
			name: title,
			properties: { parts, images, sourceUrl, description },
			relatedEntityGroups: [
				{
					entities: relatedEntities,
					direction: "outgoing" as const,
					synchronization: "authoritative" as const,
					relationshipSchemaSlug: "music-group-to-music",
				},
			],
		};
	});

export const buildAlbumTranslate = (client: AlbumClient, externalId: string) =>
	client.music.getAlbum(externalId).then((album) => {
		const name = getAlbumTitle(asRecord(album));
		return name ? { name } : {};
	});

export const search = defineProviderDriver(manifest, "search", (input, host) =>
	createYoutubeMusicClient(host).then((client) =>
		buildAlbumSearch(client, input.query, input.pageSize),
	),
);

export const details = defineProviderDriver(manifest, "details", (input, host) =>
	createYoutubeMusicClient(host, manifest.providerInformation.canonicalLanguage).then((client) =>
		buildAlbumDetails(client, input.externalId),
	),
);

export const translate = defineProviderDriver(manifest, "translate", (input, host) =>
	createYoutubeMusicClient(host, input.language).then((client) =>
		buildAlbumTranslate(client, input.externalId),
	),
);

export default defineProvider({ manifest, drivers: { search, details, translate } });
