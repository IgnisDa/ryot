import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import type {
	ProviderRelatedInput,
	ProviderRelatedResult,
} from "@ryot-app/plugin-backend-sdk/provider";
import { asArray, asRecord } from "@ryot-app/plugin-backend-sdk/wire";
import {
	GridContinuation,
	MusicPlaylistShelfContinuation,
	YTNodes,
} from "@ryot-app/plugin-backend-sdk/youtubei";

import { MediaSandboxError } from "../../../lib/failures";
import { normalizePlainDescription } from "../../../lib/plain-description";
import { stringValue, type UnknownRecord } from "../../../lib/records";
import { createRoleAccumulator } from "../../../lib/role-accumulator";
import {
	type ArtistClient,
	coerceTrimmed,
	getThumbnailUrls,
	type MusicSearchClient,
	searchYoutubeMusic,
	tryYoutubeMusic,
} from "../../../lib/vendors/youtube-music";

const getArtistName = (artist: null | UnknownRecord) => {
	const raw = asRecord(asRecord(artist?.["header"])?.["title"])?.["text"] ?? artist?.["name"] ?? "";
	return coerceTrimmed(raw);
};

const artistSources = (artist: null | UnknownRecord, albums: boolean) => {
	const sources = new Map<string, { browseId: string; playlist: boolean; params: null | string }>();
	const add = (browseId: string, params: null | string, playlist: boolean) => {
		sources.set(JSON.stringify([browseId, params]), { params, browseId, playlist });
	};
	for (const section of asArray(artist?.["sections"])) {
		const record = asRecord(section);
		if (record?.["type"] === "MusicShelf") {
			const payload = asRecord(asRecord(record["endpoint"])?.["payload"]);
			const playlistId = stringValue(payload?.["browseId"]);
			if (playlistId && !albums) {
				add(playlistId, stringValue(payload?.["params"]), true);
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
			if (pageType === "MUSIC_PAGE_TYPE_ARTIST_DISCOGRAPHY" && albums) {
				add(browseId, stringValue(payload?.["params"]), false);
			} else if (
				!albums &&
				pageType === "MUSIC_PAGE_TYPE_PLAYLIST" &&
				asArray(record["contents"]).some((item) => asRecord(item)?.["item_type"] === "video")
			) {
				add(browseId, stringValue(payload?.["params"]), true);
			}
		}
	}
	return [...sources.values()];
};

export const buildArtistRelated = Effect.fn(function* (
	client: ArtistClient,
	input: ProviderRelatedInput,
): Effect.fn.Return<ProviderRelatedResult, MediaSandboxError> {
	const albums = input.relationshipSchemaSlug === "person-to-music-group";
	if (
		input.direction !== "outgoing" ||
		(!albums && input.relationshipSchemaSlug !== "person-to-music")
	) {
		return yield* new MediaSandboxError({ message: "Unsupported YouTube Music artist inventory" });
	}
	const cursor = asRecord(input.continuation);
	const source = cursor?.["source"];
	const token = cursor?.["token"];
	if (
		typeof source !== "number" ||
		!Number.isSafeInteger(source) ||
		source < 0 ||
		(token !== undefined && !stringValue(token))
	) {
		return yield* new MediaSandboxError({ message: "Invalid YouTube Music artist continuation" });
	}
	const artist = asRecord(yield* tryYoutubeMusic(() => client.music.getArtist(input.externalId)));
	const sources = artistSources(artist, albums);
	const endpoint = sources[source];
	if (!endpoint) {
		return yield* new MediaSandboxError({
			message: "YouTube Music artist inventory endpoint disappeared",
		});
	}
	const browseId =
		endpoint.playlist && !endpoint.browseId.startsWith("VL")
			? `VL${endpoint.browseId}`
			: endpoint.browseId;
	const page = yield* tryYoutubeMusic(() =>
		client.actions.execute("/browse", {
			parse: true,
			client: "YTMUSIC",
			...(typeof token === "string"
				? { continuation: token }
				: { browseId, ...(endpoint.params === null ? {} : { params: endpoint.params }) }),
		}),
	);
	const grid = page.contents_memo?.getType(YTNodes.Grid)[0];
	const shelf = page.contents_memo?.getType(YTNodes.MusicPlaylistShelf)[0];
	const continued = page.continuation_contents;
	const continuedGrid = continued?.is(GridContinuation) ? continued : undefined;
	const continuedShelf = continued?.is(MusicPlaylistShelfContinuation) ? continued : undefined;
	const contents =
		grid?.items ??
		shelf?.contents ??
		continuedGrid?.items ??
		continuedShelf?.contents ??
		page.on_response_received_actions?.firstOfType(YTNodes.AppendContinuationItemsAction)?.contents;
	if (!contents) {
		return yield* new MediaSandboxError({
			message: "YouTube Music artist inventory is missing items",
		});
	}
	const nextToken =
		grid?.continuation ??
		shelf?.continuation ??
		continuedGrid?.continuation ??
		continuedShelf?.continuation ??
		stringValue(
			asRecord(contents.firstOfType(YTNodes.ContinuationItem)?.endpoint.payload)?.["token"],
		);
	if (nextToken && nextToken === token) {
		return yield* new MediaSandboxError({
			message: "YouTube Music artist continuation did not advance",
		});
	}
	const entities = collectArtistEntities(null, contents);
	let coverage: ProviderRelatedResult["coverage"] = { status: "complete" };
	if (nextToken) {
		coverage = { status: "more", continuation: { source, token: nextToken } };
	} else if (source + 1 < sources.length) {
		coverage = { status: "more", continuation: { source: source + 1 } };
	}
	return { coverage, entities: albums ? entities.groups : entities.media };
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

export const buildArtistSearch = (
	client: MusicSearchClient,
	query: string,
	pageSize = 20,
	page = 1,
) => searchYoutubeMusic(client, query, "artist", pageSize, page);

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
		const { media, groups } = collectArtistEntities(artistRecord, []);
		const coverage = (albums: boolean) =>
			artistSources(artistRecord, albums).length > 0
				? { status: "more" as const, continuation: { source: 0 } }
				: {
						status: "source-limited" as const,
						reason: "Artist page exposes no complete inventory endpoint",
					};

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
					coverage: coverage(false),
					direction: "outgoing" as const,
					synchronization: "additive" as const,
					relationshipSchemaSlug: "person-to-music",
				},
				{
					entities: groups,
					coverage: coverage(true),
					direction: "outgoing" as const,
					synchronization: "additive" as const,
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
