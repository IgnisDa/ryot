import { withApprovedDependencyRuntime } from "@ryot-app/plugin-backend-sdk/dependency-runtime";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { asArray, asRecord } from "@ryot-app/plugin-backend-sdk/wire";
import { GridContinuation, YTNodes } from "@ryot-app/plugin-backend-sdk/youtubei";

import { MediaSandboxError } from "../../../lib/failures";
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

const collectArtistPlaylist = Effect.fn(function* (client: ArtistClient, playlistId: string) {
	let page = yield* tryYoutubeMusic(() => client.music.getPlaylist(playlistId));
	const items: unknown[] = [...page.items];
	while (page.has_continuation) {
		page = yield* tryYoutubeMusic(() =>
			withApprovedDependencyRuntime(() => page.getContinuation()),
		);
		items.push(...page.items);
	}
	return items;
});

const collectArtistDiscography = Effect.fn(function* (
	client: ArtistClient,
	browseId: string,
	params: null | string,
) {
	let page = yield* tryYoutubeMusic(() =>
		client.actions.execute("/browse", {
			browseId,
			client: "YTMUSIC",
			...(params === null ? {} : { params }),
			parse: true,
		}),
	);
	const items: unknown[] = [];
	for (;;) {
		const grid = page.contents_memo?.getType(YTNodes.Grid)[0];
		const continuedGrid = page.continuation_contents?.is(GridContinuation)
			? page.continuation_contents
			: undefined;
		const contents =
			grid?.items ??
			continuedGrid?.items ??
			page.on_response_received_actions?.firstOfType(YTNodes.AppendContinuationItemsAction)
				?.contents;
		if (!contents) {
			return yield* new MediaSandboxError({
				message: "YouTube Music artist discography is missing its items",
			});
		}
		items.push(...contents);
		const continuation =
			grid?.continuation ??
			continuedGrid?.continuation ??
			stringValue(
				asRecord(contents.firstOfType(YTNodes.ContinuationItem)?.endpoint.payload)?.["token"],
			);
		if (!continuation) {
			return items;
		}
		page = yield* tryYoutubeMusic(() =>
			client.actions.execute("/browse", { parse: true, continuation, client: "YTMUSIC" }),
		);
	}
});

const collectArtistInventories = Effect.fn(function* (
	client: ArtistClient,
	artist: null | UnknownRecord,
) {
	const items: unknown[] = [];
	for (const section of asArray(artist?.["sections"])) {
		const record = asRecord(section);
		if (record?.["type"] === "MusicShelf") {
			const playlistId = stringValue(
				asRecord(asRecord(record["endpoint"])?.["payload"])?.["browseId"],
			);
			if (playlistId) {
				items.push(...(yield* collectArtistPlaylist(client, playlistId)));
			}
		} else if (record?.["type"] === "MusicCarouselShelf") {
			const more = asRecord(asRecord(record["header"])?.["more_content"]);
			const payload = asRecord(asRecord(more?.["endpoint"])?.["payload"]);
			const browseId = stringValue(payload?.["browseId"]);
			if (!browseId) {
				continue;
			}
			const pageType = asRecord(
				asRecord(payload?.["browseEndpointContextSupportedConfigs"])?.[
					"browseEndpointContextMusicConfig"
				],
			)?.["pageType"];
			if (pageType === "MUSIC_PAGE_TYPE_ARTIST_DISCOGRAPHY") {
				items.push(
					...(yield* collectArtistDiscography(client, browseId, stringValue(payload?.["params"]))),
				);
			} else if (
				pageType === "MUSIC_PAGE_TYPE_PLAYLIST" &&
				asArray(record["contents"]).some((item) => asRecord(item)?.["item_type"] === "video")
			) {
				items.push(...(yield* collectArtistPlaylist(client, browseId)));
			}
		}
	}
	return items;
});

const collectArtistEntities = (artist: null | UnknownRecord, inventory: readonly unknown[]) => {
	const media = createRoleAccumulator();
	const groups = createRoleAccumulator();
	const items = asArray(artist?.["sections"]).flatMap((section) =>
		asArray(asRecord(section)?.["contents"]),
	);
	for (const item of [...items, ...inventory]) {
		const itemRecord = asRecord(item);
		const itemType = itemRecord?.["item_type"];
		if (itemType !== "album" && itemType !== "song" && itemType !== "video") {
			continue;
		}
		const id = stringValue(itemRecord?.["id"]);
		const title =
			stringValue(itemRecord?.["title"]) ?? stringValue(asRecord(itemRecord?.["title"])?.["text"]);
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
	Effect.gen(function* () {
		const artist = yield* tryYoutubeMusic(() => client.music.getArtist(externalId));
		const artistRecord = asRecord(artist);
		const name = getArtistName(artistRecord);
		if (!name) {
			throw new Error("YouTube Music artist is missing name");
		}

		const header = asRecord(artistRecord?.["header"]);
		const descriptionValue = asRecord(header?.["description"])?.["text"];
		const description = normalizePlainDescription(descriptionValue);
		const inventory = yield* collectArtistInventories(client, artistRecord);
		const { media, groups } = collectArtistEntities(artistRecord, inventory);

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
	});

export const buildArtistTranslate = (client: ArtistClient, externalId: string) =>
	tryYoutubeMusic(() => client.music.getArtist(externalId)).pipe(
		Effect.map((artist) => {
			const name = getArtistName(asRecord(artist));
			return name ? { name } : {};
		}),
	);
