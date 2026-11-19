import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import {
	PROVIDER_CONTINUATION_MAX_BYTES,
	type ProviderDetailsRelatedEntity,
	type ProviderRelatedInput,
	type ProviderRelatedResult,
} from "@ryot-app/plugin-backend-sdk/provider";
import { asArray, asRecord } from "@ryot-app/plugin-backend-sdk/wire";
import {
	MusicPlaylistShelfContinuation,
	type YTMusic,
	YTNodes,
} from "@ryot-app/plugin-backend-sdk/youtubei";

import { mediaFailureMessage } from "../../../lib/error-message";
import { MediaSandboxError } from "../../../lib/failures";
import { stringValue, type UnknownRecord } from "../../../lib/records";
import { normalizeRichDescription } from "../../../lib/rich-description";
import {
	type AlbumClient,
	coerceTrimmed,
	getBestThumbnailUrl,
	type MusicSearchClient,
	searchYoutubeMusic,
	tryYoutubeMusic,
} from "../../../lib/vendors/youtube-music";

const getAlbumTitle = (album: null | UnknownRecord) => {
	const raw = album?.["title"] ?? asRecord(asRecord(album?.["header"])?.["title"])?.["text"] ?? "";
	return coerceTrimmed(raw);
};

const albumPlaylistId = (album: null | UnknownRecord) => {
	const direct = stringValue(album?.["playlist_id"]);
	if (direct) {
		return direct;
	}
	const header = asRecord(album?.["header"]);
	const menu = asRecord(header?.["menu"]);
	for (const button of [
		...asArray(header?.["buttons"]),
		...asArray(menu?.["top_level_buttons"]),
		...asArray(menu?.["items"]),
	]) {
		const payload = asRecord(asRecord(asRecord(button)?.["endpoint"])?.["payload"]);
		const playlistId = stringValue(payload?.["playlistId"]);
		if (playlistId) {
			return playlistId;
		}
	}
	const url = stringValue(album?.["url"]);
	if (!url) {
		return null;
	}
	try {
		return stringValue(new URL(url).searchParams.get("list"));
	} catch {
		return null;
	}
};

const albumTrackTotal = (album: null | UnknownRecord) => {
	const header = asRecord(album?.["header"]);
	const count =
		stringValue(header?.["song_count"]) ??
		stringValue(asRecord(asArray(asRecord(header?.["second_subtitle"])?.["runs"])[0])?.["text"]);
	const match = count?.match(/^((?:\d{1,3}(?:,\d{3})+)|\d+) (?:songs?|tracks?)$/);
	const total = match?.[1] ? Number(match[1].replaceAll(",", "")) : null;
	return total !== null && Number.isSafeInteger(total) && total >= 0 ? total : null;
};

const albumTracks = (items: readonly unknown[], requireIds = false) => {
	const tracks = new Map<string, { id: string; name: string }>();
	for (const item of items) {
		const record = asRecord(item);
		if (record?.["type"] === "ContinuationItem") {
			continue;
		}
		const id = stringValue(record?.["id"]);
		if (!id) {
			if (requireIds) {
				throw new MediaSandboxError({
					message: "YouTube Music album playlist has a track without an ID",
				});
			}
			continue;
		}
		if (tracks.has(id)) {
			continue;
		}
		tracks.set(id, {
			id,
			name:
				stringValue(record?.["title"]) ??
				stringValue(asRecord(record?.["title"])?.["text"]) ??
				stringValue(asRecord(record?.["info"])?.["title"]) ??
				"Loading...",
		});
	}
	return [...tracks.values()];
};

const albumMembers = (
	tracks: ReturnType<typeof albumTracks>,
	offset: number,
): ProviderDetailsRelatedEntity[] =>
	tracks.map((track, index) => ({
		name: track.name,
		externalId: track.id,
		providerSlug: "music.youtube-music",
		relationshipProperties: { order: offset + index + 1 },
	}));

const playlistPage = (page: YTMusic.Playlist["page"]) => {
	const shelf = page.contents_memo?.getType(YTNodes.MusicPlaylistShelf)[0];
	const continued = page.continuation_contents?.is(MusicPlaylistShelfContinuation)
		? page.continuation_contents
		: undefined;
	const contents =
		shelf?.contents ??
		continued?.contents ??
		page.on_response_received_actions?.firstOfType(YTNodes.AppendContinuationItemsAction)?.contents;
	if (!contents) {
		throw new MediaSandboxError({ message: "YouTube Music album playlist is missing its tracks" });
	}
	const continuation =
		shelf?.continuation ??
		continued?.continuation ??
		stringValue(
			asRecord(contents.firstOfType(YTNodes.ContinuationItem)?.endpoint.payload)?.["token"],
		);
	return { continuation, tracks: albumTracks(contents, true) };
};

const getAlbumTrackPage = Effect.fn(function* (
	client: AlbumClient,
	playlistId: string,
	token: null | string,
) {
	if (token === null) {
		const playlist = yield* tryYoutubeMusic(() => client.music.getPlaylist(playlistId));
		const page = yield* Effect.try({
			try: () => playlistPage(playlist.page),
			catch: (error) => new MediaSandboxError({ message: mediaFailureMessage(error) }),
		});
		if (playlist.has_continuation && !page.continuation) {
			return yield* new MediaSandboxError({
				message: "YouTube Music album playlist is missing its continuation",
			});
		}
		return page;
	}
	const page = yield* tryYoutubeMusic(() =>
		client.actions.execute("/browse", { parse: true, client: "YTMUSIC", continuation: token }),
	);
	return yield* Effect.try({
		try: () => playlistPage(page),
		catch: (error) => new MediaSandboxError({ message: mediaFailureMessage(error) }),
	});
});

const albumCoverage = (
	playlistId: string,
	token: null | string,
	previousToken: null | string,
	offset: number,
	expectedTotal: null | number,
): Effect.Effect<ProviderRelatedResult["coverage"], MediaSandboxError> => {
	if (expectedTotal !== null && (offset > expectedTotal || (!token && offset !== expectedTotal))) {
		return Effect.fail(
			new MediaSandboxError({
				message: "YouTube Music album playlist does not match its expected track total",
			}),
		);
	}
	if (!token) {
		return Effect.succeed({ status: "complete" });
	}
	const continuation = { token, offset, playlistId, previousToken, expectedTotal };
	if (
		new TextEncoder().encode(JSON.stringify(continuation)).byteLength >
		PROVIDER_CONTINUATION_MAX_BYTES
	) {
		return Effect.fail(
			new MediaSandboxError({
				message: "YouTube Music album continuation exceeds the cursor size limit",
			}),
		);
	}
	return Effect.succeed({ continuation, status: "more" });
};

export const buildAlbumRelated = Effect.fn(function* (
	client: AlbumClient,
	input: ProviderRelatedInput,
): Effect.fn.Return<ProviderRelatedResult, MediaSandboxError> {
	const cursor = asRecord(input.continuation);
	const playlistId = stringValue(cursor?.["playlistId"]);
	const token = stringValue(cursor?.["token"]);
	const previousToken = cursor?.["previousToken"];
	const offset = cursor?.["offset"];
	const expectedTotal = cursor?.["expectedTotal"];
	if (
		input.direction !== "outgoing" ||
		input.relationshipSchemaSlug !== "music-group-to-music" ||
		!playlistId ||
		!token ||
		(previousToken !== null &&
			(typeof previousToken !== "string" || !stringValue(previousToken))) ||
		typeof offset !== "number" ||
		!Number.isSafeInteger(offset) ||
		offset < 0 ||
		(expectedTotal !== null &&
			(typeof expectedTotal !== "number" ||
				!Number.isSafeInteger(expectedTotal) ||
				expectedTotal < 0))
	) {
		return yield* new MediaSandboxError({ message: "Invalid YouTube Music album continuation" });
	}
	const acceptedIds = new Set<string>();
	const visitedTokens = new Set<string>();
	let currentToken: null | string = null;
	let priorToken: null | string = null;
	for (let sourcePages = 0; sourcePages < 40; sourcePages += 1) {
		if (currentToken !== null) {
			visitedTokens.add(currentToken);
		}
		const page: Effect.Success<ReturnType<typeof getAlbumTrackPage>> = yield* getAlbumTrackPage(
			client,
			playlistId,
			currentToken,
		);
		if (page.continuation && visitedTokens.has(page.continuation)) {
			return yield* new MediaSandboxError({
				message: "YouTube Music album continuation did not advance consistently",
			});
		}
		if (currentToken === token) {
			if (acceptedIds.size !== offset || priorToken !== previousToken) {
				return yield* new MediaSandboxError({
					message: "YouTube Music album continuation did not advance consistently",
				});
			}
			const tracks = page.tracks.filter((track) => !acceptedIds.has(track.id));
			return {
				entities: albumMembers(tracks, offset),
				coverage: yield* albumCoverage(
					playlistId,
					page.continuation,
					token,
					offset + tracks.length,
					expectedTotal,
				),
			};
		}
		for (const track of page.tracks) {
			acceptedIds.add(track.id);
		}
		if (!page.continuation || acceptedIds.size > offset) {
			return yield* new MediaSandboxError({
				message: "YouTube Music album continuation did not advance consistently",
			});
		}
		priorToken = currentToken;
		currentToken = page.continuation;
	}
	return yield* new MediaSandboxError({
		message: "YouTube Music album source exceeds the 40-page replay budget",
	});
});

export const buildAlbumSearch = (
	client: MusicSearchClient,
	query: string,
	pageSize: number,
	page = 1,
) => searchYoutubeMusic(client, query, "album", pageSize, page);

export const buildAlbumDetails = (client: AlbumClient, externalId: string) =>
	Effect.gen(function* () {
		const album = yield* tryYoutubeMusic(() => client.music.getAlbum(externalId));
		const albumRecord = asRecord(album);
		const title = getAlbumTitle(albumRecord);
		if (!title) {
			return yield* new MediaSandboxError({
				message: `YouTube Music album not found: ${externalId}`,
			});
		}

		const headerRecord = asRecord(albumRecord?.["header"]);
		const headerDescription = asRecord(headerRecord?.["description"]);
		const rawDescription =
			albumRecord?.["description"] ??
			headerDescription?.["text"] ??
			asRecord(headerDescription?.["description"])?.["text"] ??
			null;
		const description = yield* normalizeRichDescription(
			rawDescription,
			"https://music.youtube.com",
		);

		const rawTracks = albumRecord?.["contents"];
		const tracks = asArray(rawTracks);
		const parts = albumTrackTotal(albumRecord);
		const playlistId = albumPlaylistId(albumRecord);
		const page = playlistId ? yield* getAlbumTrackPage(client, playlistId, null) : null;
		const members = page?.tracks ?? albumTracks(tracks);
		const relatedEntities = albumMembers(members, 0);
		let coverage: ProviderRelatedResult["coverage"];
		if (playlistId && page) {
			coverage = yield* albumCoverage(playlistId, page.continuation, null, members.length, parts);
		} else if (
			Array.isArray(rawTracks) &&
			parts !== null &&
			parts === tracks.length &&
			members.length === parts
		) {
			coverage = { status: "complete" };
		} else {
			coverage = {
				status: "source-limited",
				reason: "Album source exposes no track playlist endpoint or matching explicit track total",
			};
		}

		const coverUrl = getBestThumbnailUrl(
			albumRecord?.["thumbnail"] ?? headerRecord?.["thumbnail"] ?? headerRecord?.["thumbnails"],
		);
		const images = coverUrl
			? [{ url: coverUrl, type: "remote" as const, purpose: "cover" as const }]
			: [];
		const sourceUrl = playlistId ? `https://music.youtube.com/playlist?list=${playlistId}` : null;

		return {
			name: title,
			properties: { parts, images, sourceUrl, description },
			relatedEntityGroups: [
				{
					coverage,
					entities: relatedEntities,
					direction: "outgoing" as const,
					synchronization: "authoritative" as const,
					relationshipSchemaSlug: "music-group-to-music",
				},
			],
		};
	});

export const buildAlbumTranslate = (client: AlbumClient, externalId: string) =>
	tryYoutubeMusic(() => client.music.getAlbum(externalId)).pipe(
		Effect.map((album) => {
			const name = getAlbumTitle(asRecord(album));
			return name ? { name } : {};
		}),
	);
