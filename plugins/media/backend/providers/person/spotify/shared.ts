import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import {
	defineProvider,
	type ProviderDetailsRelatedEntity,
	type ProviderRelatedResult,
} from "@ryot-app/plugin-backend-sdk/provider";
import { asArray, asRecord } from "@ryot-app/plugin-backend-sdk/wire";

import { MediaSandboxError } from "../../../lib/failures";
import { normalizePlainDescription } from "../../../lib/plain-description";
import { numberValue, stringValue } from "../../../lib/records";
import {
	getFirstImage,
	getImagesSortedBySize,
	SPOTIFY_SEARCH_PAGE_SIZE,
	spotifyGet,
	type SpotifyHost,
	spotifyInventoryLimit,
	spotifyOffsetCursor,
	spotifyPage,
} from "../../../lib/vendors/spotify";

export const manifest = defineManifest({
	name: "Spotify",
	kind: "provider",
	slug: "person.spotify",
});

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) => {
		const offset = (input.page - 1) * SPOTIFY_SEARCH_PAGE_SIZE;
		return spotifyGet(host, "/search", {
			type: "artist",
			q: input.query,
			offset: String(offset),
			limit: String(SPOTIFY_SEARCH_PAGE_SIZE),
		}).pipe(
			Effect.map((dataValue) => {
				const artists = asRecord(asRecord(dataValue)?.["artists"]);
				const totalItems = numberValue(artists?.["total"]) ?? 0;
				const artistItems = asArray(artists?.["items"]);
				const items = artistItems.flatMap((artist) => {
					const record = asRecord(artist);
					const externalId = stringValue(record?.["id"]);
					if (!externalId) {
						return [];
					}
					const imageUrl = getFirstImage(record?.["images"]);
					return [
						{
							externalId,
							title: stringValue(record?.["name"]) ?? externalId,
							...(imageUrl === null ? {} : { imageUrl }),
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
			}),
		);
	},
});

const artistAlbums = Effect.fnUntraced(function* (
	host: SpotifyHost,
	externalId: string,
	offset: number,
	total: null | number,
) {
	return yield* spotifyGet(host, `/artists/${encodeURIComponent(externalId)}/albums`, {
		limit: "10",
		offset: String(offset),
		include_groups: "album,single,appears_on,compilation",
	}).pipe(Effect.flatMap((value) => spotifyPage(value, offset, total)));
});

const discoveryEntity = (
	item: Record<string, unknown>,
	providerSlug: string,
): ProviderDetailsRelatedEntity => ({
	providerSlug,
	externalId: stringValue(item["id"]) ?? "",
	relationshipProperties: { roles: ["Artist"] },
	name: stringValue(item["name"]) ?? stringValue(item["id"]) ?? "Loading...",
});

const albumIds = (items: readonly Record<string, unknown>[]) => [
	...new Set(
		items.flatMap((item) => {
			const id = stringValue(item["id"]);
			return id ? [id] : [];
		}),
	),
];

const albumEntities = (items: readonly Record<string, unknown>[]) => {
	const entities = new Map<string, ProviderDetailsRelatedEntity>();
	for (const item of items) {
		const entity = discoveryEntity(item, "music-group.spotify");
		if (!entities.has(entity.externalId)) {
			entities.set(entity.externalId, entity);
		}
	}
	return [...entities.values()];
};

const albumCoverage = (page: {
	total: number;
	nextOffset: null | number;
}): ProviderRelatedResult["coverage"] =>
	page.nextOffset === null
		? { status: "complete" }
		: { status: "more", continuation: { total: page.total, offset: page.nextOffset } };

const sourceLimit = (): ProviderRelatedResult => ({
	entities: [],
	coverage: {
		status: "source-limited",
		reason: "Spotify denied access to the artist's album or track catalog (HTTP 403)",
	},
});

const trackCursor = Effect.fnUntraced(function* (value: unknown) {
	const record = asRecord(value);
	const albums = yield* spotifyOffsetCursor({
		total: record?.["albumsTotal"],
		offset: record?.["albumsOffset"],
	});
	const pending = record?.["pending"];
	const trackOffset = record?.["trackOffset"];
	const trackTotal = record?.["trackTotal"];
	if (
		!Array.isArray(pending) ||
		pending.length > 50 ||
		typeof trackOffset !== "number" ||
		!Number.isSafeInteger(trackOffset) ||
		trackOffset < 0 ||
		(trackTotal !== null &&
			(typeof trackTotal !== "number" ||
				!Number.isSafeInteger(trackTotal) ||
				trackTotal < trackOffset))
	) {
		return yield* new MediaSandboxError({ message: "Invalid Spotify artist track continuation" });
	}
	const ids: string[] = [];
	for (const id of pending) {
		if (typeof id !== "string" || !/^[a-zA-Z0-9]{1,64}$/.test(id)) {
			return yield* new MediaSandboxError({
				message: "Invalid Spotify artist album ID in continuation",
			});
		}
		ids.push(id);
	}
	if (ids.length === 0 && (trackOffset !== 0 || trackTotal !== null)) {
		return yield* new MediaSandboxError({
			message: "Spotify artist continuation has no current album",
		});
	}
	return {
		trackTotal,
		trackOffset,
		pending: ids,
		albumsTotal: albums.total,
		albumsOffset: albums.offset,
	};
});

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) =>
		Effect.gen(function* () {
			const artist = asRecord(
				yield* spotifyGet(host, `/artists/${encodeURIComponent(input.externalId)}`),
			);
			const name = stringValue(artist?.["name"]);
			if (!name) {
				return yield* new MediaSandboxError({ message: "Spotify artist is missing name" });
			}
			const genres = asArray(artist?.["genres"]).flatMap((genre) =>
				typeof genre === "string" ? [genre] : [],
			);
			const inventories = yield* artistAlbums(host, input.externalId, 0, null).pipe(
				Effect.map((page) => ({
					albums: { coverage: albumCoverage(page), entities: albumEntities(page.items) },
					tracks: {
						entities: [],
						coverage:
							page.items.length === 0
								? { status: "complete" as const }
								: {
										status: "more" as const,
										continuation: {
											trackOffset: 0,
											trackTotal: null,
											albumsTotal: page.total,
											pending: albumIds(page.items),
											albumsOffset: page.nextOffset ?? page.total,
										},
									},
					},
				})),
				Effect.catchIf(spotifyInventoryLimit, () =>
					Effect.succeed({ albums: sourceLimit(), tracks: sourceLimit() }),
				),
			);
			return {
				name,
				relatedEntityGroups: [
					{
						...inventories.tracks,
						direction: "outgoing" as const,
						synchronization: "additive" as const,
						relationshipSchemaSlug: "person-to-music",
					},
					{
						...inventories.albums,
						direction: "outgoing" as const,
						synchronization: "authoritative" as const,
						relationshipSchemaSlug: "person-to-music-group",
					},
				],
				properties: {
					alternateNames: [],
					sourceUrl: stringValue(asRecord(artist?.["external_urls"])?.["spotify"]),
					description: normalizePlainDescription(
						genres.length > 0 ? `Genres: ${genres.join(", ")}` : null,
					),
					images: getImagesSortedBySize(artist?.["images"]).map((url) => ({
						url,
						type: "remote" as const,
						purpose: "profile" as const,
					})),
				},
			};
		}),
});

const relatedAlbums = Effect.fnUntraced(function* (
	host: SpotifyHost,
	externalId: string,
	continuation: unknown,
) {
	let { total, offset } = yield* spotifyOffsetCursor(continuation);
	const entities = new Map<string, ProviderDetailsRelatedEntity>();
	for (let calls = 0; calls < 40; calls++) {
		const page = yield* artistAlbums(host, externalId, offset, total);
		for (const item of page.items) {
			const entity = discoveryEntity(item, "music-group.spotify");
			if (!entities.has(entity.externalId)) {
				entities.set(entity.externalId, entity);
			}
		}
		if (page.nextOffset === null) {
			return { entities: [...entities.values()], coverage: { status: "complete" as const } };
		}
		offset = page.nextOffset;
		total = page.total;
	}
	return {
		entities: [...entities.values()],
		coverage: { status: "more" as const, continuation: { total, offset } },
	};
});

const relatedTracks = Effect.fnUntraced(function* (
	host: SpotifyHost,
	externalId: string,
	continuation: unknown,
) {
	const cursor = yield* trackCursor(continuation);
	const entities = new Map<string, ProviderDetailsRelatedEntity>();
	for (let calls = 0; calls < 40; calls++) {
		const albumId = cursor.pending[0];
		if (albumId === undefined) {
			if (cursor.albumsOffset === cursor.albumsTotal) {
				return { entities: [...entities.values()], coverage: { status: "complete" as const } };
			}
			const page = yield* artistAlbums(host, externalId, cursor.albumsOffset, cursor.albumsTotal);
			cursor.pending = albumIds(page.items);
			cursor.albumsOffset = page.nextOffset ?? page.total;
			continue;
		}
		const value = yield* spotifyGet(host, `/albums/${encodeURIComponent(albumId)}/tracks`, {
			limit: "50",
			offset: String(cursor.trackOffset),
		});
		const page = yield* spotifyPage(value, cursor.trackOffset, cursor.trackTotal);
		for (const track of page.items) {
			const artists = track["artists"];
			if (
				!Array.isArray(artists) ||
				artists.length === 0 ||
				artists.some((artist) => !stringValue(asRecord(artist)?.["id"]))
			) {
				return yield* new MediaSandboxError({
					message: "Spotify catalog track is missing artist credits",
				});
			}
			if (artists.some((artist) => stringValue(asRecord(artist)?.["id"]) === externalId)) {
				const entity = discoveryEntity(track, "music.spotify");
				if (!entities.has(entity.externalId)) {
					entities.set(entity.externalId, entity);
				}
			}
		}
		if (page.nextOffset === null) {
			cursor.trackOffset = 0;
			cursor.trackTotal = null;
			cursor.pending = cursor.pending.slice(1);
		} else {
			cursor.trackTotal = page.total;
			cursor.trackOffset = page.nextOffset;
		}
	}
	return {
		entities: [...entities.values()],
		coverage:
			cursor.pending.length === 0 && cursor.albumsOffset === cursor.albumsTotal
				? { status: "complete" as const }
				: { continuation: cursor, status: "more" as const },
	};
});

export const related = defineProvider({
	manifest,
	operation: "related",
	run: (input, host) => {
		if (input.direction !== "outgoing") {
			return Effect.fail(
				new MediaSandboxError({ message: "Unsupported Spotify artist inventory direction" }),
			);
		}
		const operation = Effect.gen(function* () {
			if (input.relationshipSchemaSlug === "person-to-music") {
				return yield* relatedTracks(host, input.externalId, input.continuation);
			}
			if (input.relationshipSchemaSlug === "person-to-music-group") {
				return yield* relatedAlbums(host, input.externalId, input.continuation);
			}
			return yield* new MediaSandboxError({ message: "Unsupported Spotify artist inventory" });
		});
		return operation.pipe(
			Effect.catchIf(spotifyInventoryLimit, () => Effect.succeed(sourceLimit())),
		);
	},
});
