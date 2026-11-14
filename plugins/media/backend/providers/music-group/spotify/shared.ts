import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import {
	defineProvider,
	type ProviderDetailsRelatedEntity,
	type ProviderRelatedResult,
} from "@ryot-app/plugin-backend-sdk/provider";
import { asArray, asRecord } from "@ryot-app/plugin-backend-sdk/wire";

import { MediaSandboxError } from "../../../lib/failures";
import { numberValue, stringValue } from "../../../lib/records";
import { normalizeRichDescription } from "../../../lib/rich-description";
import {
	getImagesSortedBySize,
	SPOTIFY_SEARCH_PAGE_SIZE,
	spotifyGet,
	spotifyInventoryLimit,
	spotifyOffsetCursor,
	spotifyPage,
} from "../../../lib/vendors/spotify";

export const manifest = defineManifest({
	name: "Spotify",
	kind: "provider",
	slug: "music-group.spotify",
});

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) => {
		const offset = (input.page - 1) * SPOTIFY_SEARCH_PAGE_SIZE;
		return spotifyGet(host, "/search", {
			type: "album",
			q: input.query,
			offset: String(offset),
			limit: String(SPOTIFY_SEARCH_PAGE_SIZE),
		}).pipe(
			Effect.map((dataValue) => {
				const albums = asRecord(asRecord(dataValue)?.["albums"]);
				const totalItems = numberValue(albums?.["total"]) ?? 0;
				const albumItems = asArray(albums?.["items"]);
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
							title: name,
							externalId: id,
							...(imageUrl === null ? {} : { imageUrl }),
							...(parts === null ? {} : { metadata: [parts] as const }),
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
			}),
		);
	},
});

const trackEntities = (items: readonly Record<string, unknown>[], offset: number) => {
	const entities = new Map<string, ProviderDetailsRelatedEntity>();
	for (const [index, track] of items.entries()) {
		const externalId = stringValue(track["id"]);
		if (externalId && !entities.has(externalId)) {
			entities.set(externalId, {
				externalId,
				providerSlug: "music.spotify",
				name: stringValue(track["name"]) ?? "Loading...",
				relationshipProperties: { order: offset + index + 1 },
			});
		}
	}
	return [...entities.values()];
};

const trackCoverage = (page: {
	total: number;
	nextOffset: null | number;
}): ProviderRelatedResult["coverage"] =>
	page.nextOffset === null
		? { status: "complete" }
		: { status: "more", continuation: { total: page.total, offset: page.nextOffset } };

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) =>
		Effect.gen(function* () {
			const albumValue = yield* spotifyGet(host, `/albums/${encodeURIComponent(input.externalId)}`);
			const album = asRecord(albumValue);
			const title = stringValue(album?.["name"]);
			if (!title) {
				return yield* new MediaSandboxError({ message: "Spotify album is missing name" });
			}

			const parts = numberValue(album?.["total_tracks"]);
			const description = yield* normalizeRichDescription(
				album?.["description"],
				"https://open.spotify.com",
			);
			const page = yield* spotifyPage(album?.["tracks"], 0, parts);
			const artistCredits = album?.["artists"];

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
						purpose: "cover" as const,
					})),
				},
				relatedEntityGroups: [
					{
						coverage: trackCoverage(page),
						direction: "outgoing" as const,
						entities: trackEntities(page.items, 0),
						synchronization: "authoritative" as const,
						relationshipSchemaSlug: "music-group-to-music",
					},
					{
						direction: "incoming" as const,
						synchronization: "additive" as const,
						relationshipSchemaSlug: "person-to-music-group",
						coverage:
							Array.isArray(artistCredits) &&
							artistCredits.every((artist) => stringValue(asRecord(artist)?.["id"]))
								? { status: "complete" as const }
								: {
										status: "source-limited" as const,
										reason: "Spotify album response did not include artist credits",
									},
						entities: asArray(artistCredits).flatMap((value) => {
							const artist = asRecord(value);
							const externalId = stringValue(artist?.["id"]);
							return externalId
								? [
										{
											externalId,
											providerSlug: "person.spotify",
											relationshipProperties: { roles: ["Artist"] },
											name: stringValue(artist?.["name"]) ?? externalId,
										},
									]
								: [];
						}),
					},
				],
			};
		}),
});

export const related = defineProvider({
	manifest,
	operation: "related",
	run: (input, host) =>
		Effect.gen(function* () {
			if (
				input.relationshipSchemaSlug !== "music-group-to-music" ||
				input.direction !== "outgoing"
			) {
				return yield* new MediaSandboxError({ message: "Unsupported Spotify album inventory" });
			}
			let { total, offset } = yield* spotifyOffsetCursor(input.continuation);
			const entities = new Map<string, ProviderDetailsRelatedEntity>();
			for (let calls = 0; calls < 40; calls++) {
				const value = yield* spotifyGet(
					host,
					`/albums/${encodeURIComponent(input.externalId)}/tracks`,
					{ limit: "50", offset: String(offset) },
				);
				const page = yield* spotifyPage(value, offset, total);
				for (const entity of trackEntities(page.items, offset)) {
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
		}).pipe(
			Effect.catchIf(spotifyInventoryLimit, () =>
				Effect.succeed({
					entities: [],
					coverage: {
						status: "source-limited" as const,
						reason: "Spotify denied access to this album's track inventory (HTTP 403)",
					},
				}),
			),
		),
});
