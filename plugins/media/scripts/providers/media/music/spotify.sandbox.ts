import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { DateTime, Effect, Option } from "@ryot/sandbox-sdk/effect";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import { asRecord, numberValue, stringValue, trimmedString } from "../../../script-helpers/records";
import { createRoleAccumulator } from "../../../script-helpers/role-accumulator";
import { getFirstImage, getImagesSortedBySize, spotifyGet } from "../../spotify-shared";

export const manifest = defineManifest({
	name: "Spotify",
	kind: "provider",
	slug: "music.spotify",
	providerInformation: { source: "spotify" },
	capabilities: ["httpCall", "getAppConfigValue", "getCachedValue", "setCachedValue"],
	requiredAppConfigKeys: ["music.spotifyClientId", "music.spotifyClientSecret"],
});

const getPublishYear = (releaseDate: unknown) => {
	const value = stringValue(releaseDate);
	if (!value) {
		return null;
	}
	const parsed = DateTime.make(value);
	if (Option.isNone(parsed)) {
		return null;
	}
	const year = DateTime.toDateUtc(parsed.value).getFullYear();
	return year > 0 ? year : null;
};

const getPublishDate = (releaseDate: unknown) => {
	const value = stringValue(releaseDate);
	if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return null;
	}
	return value;
};

export const search = defineProviderDriver(manifest, "search", (input, host) => {
	const offset = (input.page - 1) * input.pageSize;
	return spotifyGet(host, "/search", {
		type: "track",
		q: input.query,
		offset: String(offset),
		limit: String(input.pageSize),
	}).pipe(
		Effect.map((dataValue) => {
			const tracks = asRecord(asRecord(dataValue)?.["tracks"]);
			const totalItems = numberValue(tracks?.["total"]) ?? 0;
			const trackItems = Array.isArray(tracks?.["items"]) ? tracks["items"] : [];
			const items = trackItems.flatMap((track) => {
				const record = asRecord(track);
				const externalId = stringValue(record?.["id"]);
				if (!externalId) {
					return [];
				}
				const title = stringValue(record?.["name"]) ?? externalId;
				const album = asRecord(record?.["album"]);
				const publishYear = album ? getPublishYear(album["release_date"]) : null;
				const imageUrl = album ? getFirstImage(album["images"]) : null;
				return [
					{
						externalId,
						titleProperty: { kind: "text" as const, value: title },
						calloutProperty: { kind: "null" as const, value: null },
						secondarySubtitleProperty: { kind: "null" as const, value: null },
						imageProperty:
							imageUrl === null
								? { kind: "null" as const, value: null }
								: { kind: "image" as const, value: { type: "remote" as const, url: imageUrl } },
						primarySubtitleProperty:
							publishYear === null
								? { kind: "null" as const, value: null }
								: { kind: "number" as const, value: publishYear },
					},
				];
			});
			return {
				items,
				details: {
					totalItems,
					nextPage: offset + trackItems.length < totalItems ? input.page + 1 : null,
				},
			};
		}),
	);
});

export const details = defineProviderDriver(manifest, "details", (input, host) =>
	Effect.gen(function* () {
		const trackValue = yield* spotifyGet(host, `/tracks/${encodeURIComponent(input.externalId)}`);
		const track = asRecord(trackValue);
		const title = stringValue(track?.["name"]);
		if (!title) {
			return yield* Effect.fail(new Error("Spotify track is missing name"));
		}

		const artists = Array.isArray(track?.["artists"]) ? track["artists"] : [];
		const byVariousArtists = artists.length === 0 ? null : artists.length > 1;

		const accumulator = createRoleAccumulator();
		for (const artist of artists) {
			const artistRecord = asRecord(artist);
			const artistId = stringValue(artistRecord?.["id"]);
			if (!artistId) {
				continue;
			}
			accumulator.add({
				externalId: artistId,
				scriptSlug: "person.spotify",
				relationshipProperties: { roles: ["Artist"] },
				name: trimmedString(artistRecord?.["name"]),
			});
		}

		const album = asRecord(track?.["album"]);
		const albumId = stringValue(album?.["id"]);
		const albumName = stringValue(album?.["name"]);
		if (album && albumId && albumName) {
			accumulator.add({
				name: albumName,
				externalId: albumId,
				scriptSlug: "music-group.spotify",
				relationshipProperties: { roles: ["Member"] },
			});
		}

		const publishYear = album ? getPublishYear(album["release_date"]) : null;
		const durationMs = numberValue(track?.["duration_ms"]);
		const duration = durationMs === null ? null : Math.trunc(durationMs / 1000);
		const popularity = numberValue(track?.["popularity"]);
		const explicit = track?.["explicit"];
		const isNsfw = typeof explicit === "boolean" ? explicit : null;
		const sourceUrl = stringValue(asRecord(track?.["external_urls"])?.["spotify"]);

		return {
			name: title,
			relatedEntityGroups: [
				{
					direction: "incoming" as const,
					synchronization: "additive" as const,
					relationshipSchemaSlug: "person-to-music",
					entities: accumulator.entities.filter((entity) => entity.scriptSlug === "person.spotify"),
				},
				{
					direction: "incoming" as const,
					synchronization: "additive" as const,
					relationshipSchemaSlug: "music-group-to-music",
					entities: accumulator.entities.filter(
						(entity) => entity.scriptSlug === "music-group.spotify",
					),
				},
			],
			properties: {
				isNsfw,
				duration,
				sourceUrl,
				genres: [],
				publishYear,
				byVariousArtists,
				providerRating: popularity,
				publishDate: album ? getPublishDate(album["release_date"]) : null,
				images: getImagesSortedBySize(album?.["images"]).map((url) => ({
					url,
					type: "remote" as const,
				})),
			},
		};
	}),
);

export default defineProvider({ manifest, drivers: { search, details } });
