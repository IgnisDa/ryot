import { defineManifest } from "@ryot/sandbox-sdk";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import { asRecord, numberValue, stringValue } from "../../script-helpers/records";
import { getImagesSortedBySize, spotifyGet } from "../spotify-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Spotify",
	slug: "music-group.spotify",
	providerInformation: { source: "spotify" },
	capabilities: ["httpCall", "getAppConfigValue", "getCachedValue", "setCachedValue"],
	requiredAppConfigKeys: ["providers.spotifyClientId", "providers.spotifyClientSecret"],
});

export const search = defineProviderDriver(manifest, "search", (input, host) => {
	const offset = (input.page - 1) * input.pageSize;
	return spotifyGet(host, "/search", {
		type: "album",
		q: input.query,
		offset: String(offset),
		limit: String(input.pageSize),
	}).then((dataValue) => {
		const albums = asRecord(asRecord(dataValue)?.["albums"]);
		const totalItems = numberValue(albums?.["total"]) ?? 0;
		const albumItems = Array.isArray(albums?.["items"]) ? albums["items"] : [];
		const items = albumItems.flatMap((album) => {
			const record = asRecord(album);
			const id = stringValue(record?.["id"]);
			const name = stringValue(record?.["name"]);
			if (!id || !name) {
				return [];
			}
			const parts = numberValue(record?.["total_tracks"]);
			const imageUrl = getImagesSortedBySize(record?.["images"])[0] ?? null;
			return [
				{
					externalId: id,
					titleProperty: { kind: "text" as const, value: name },
					calloutProperty: { kind: "null" as const, value: null },
					secondarySubtitleProperty: { kind: "null" as const, value: null },
					imageProperty:
						imageUrl === null
							? { kind: "null" as const, value: null }
							: { kind: "image" as const, value: { type: "remote" as const, url: imageUrl } },
					primarySubtitleProperty:
						parts === null
							? { kind: "null" as const, value: null }
							: { kind: "number" as const, value: parts },
				},
			];
		});
		return {
			items,
			details: {
				totalItems,
				nextPage: offset + albumItems.length < totalItems ? input.page + 1 : null,
			},
		};
	});
});

export const details = defineProviderDriver(manifest, "details", (input, host) =>
	spotifyGet(host, `/albums/${encodeURIComponent(input.externalId)}`).then((albumValue) => {
		const album = asRecord(albumValue);
		const title = stringValue(album?.["name"]);
		if (!title) {
			throw new Error("Spotify album is missing name");
		}

		const parts = numberValue(album?.["total_tracks"]);
		const description = stringValue(album?.["description"]);
		const tracksRecord = asRecord(album?.["tracks"]);
		const trackItems = Array.isArray(tracksRecord?.["items"]) ? tracksRecord["items"] : [];
		const relatedEntities = trackItems.flatMap((item, index) => {
			const record = asRecord(item);
			const track = asRecord(record?.["track"]) ?? record;
			const memberId = stringValue(track?.["id"]);
			if (!memberId) {
				return [];
			}
			const memberName = stringValue(track?.["name"]) ?? "Loading...";
			return [
				{
					name: memberName,
					externalId: memberId,
					scriptSlug: "music.spotify",
					relationshipProperties: { order: index + 1 },
				},
			];
		});

		const spotifyUrl = asRecord(album?.["external_urls"])?.["spotify"];
		const sourceUrl = typeof spotifyUrl === "string" ? spotifyUrl : null;

		return {
			name: title,
			properties: {
				parts,
				sourceUrl,
				description,
				images: getImagesSortedBySize(album?.["images"]).map((url) => ({
					url,
					type: "remote" as const,
				})),
			},
			relatedEntityGroups: [
				{
					direction: "outgoing" as const,
					entities: relatedEntities,
					synchronization: "authoritative" as const,
					relationshipSchemaSlug: "music-group-to-music",
				},
			],
		};
	}),
);

export default defineProvider({ manifest, drivers: { search, details } });
