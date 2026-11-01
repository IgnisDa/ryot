import { withApprovedDependencyRuntime } from "@ryot-app/plugin-backend-sdk/dependency-runtime";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import type { ProviderSearchResultItem } from "@ryot-app/plugin-backend-sdk/provider";
import { asArray, asRecord } from "@ryot-app/plugin-backend-sdk/wire";
import type { Innertube, YoutubeiHost, YTMusic } from "@ryot-app/plugin-backend-sdk/youtubei";
import {
	createYoutubeHistoryClient as createSdkYoutubeHistoryClient,
	createYoutubeMusicClient as createSdkYoutubeMusicClient,
} from "@ryot-app/plugin-backend-sdk/youtubei";

import { mediaFailureMessage } from "../error-message";
import { MediaSandboxError } from "../failures";
import { numberValue, stringValue } from "../records";

const toMediaSandboxError = (error: unknown) =>
	new MediaSandboxError({ message: mediaFailureMessage(error) });

export const tryYoutubeMusic = <A>(tryCall: () => Promise<A>) =>
	Effect.tryPromise({
		catch: toMediaSandboxError,
		try: () => withApprovedDependencyRuntime(tryCall),
	});

export type YoutubeMusicHost = YoutubeiHost;

export type HistoryClient = { getHistory: () => Effect.Effect<unknown, MediaSandboxError> };

export type TrackQueueClient = { music: { getUpNext: (videoId: string) => Promise<unknown> } };

export type MusicSearchClient = {
	music: { search: (query: string, filters: { type: MusicSearchType }) => Promise<unknown> };
};

export type AlbumClient = {
	actions: Pick<Innertube["actions"], "execute">;
	music: {
		getAlbum: (albumId: string) => Promise<unknown>;
		getPlaylist: (
			playlistId: string,
		) => Promise<Pick<YTMusic.Playlist, "page" | "items" | "has_continuation">>;
	};
};

export type ArtistClient = {
	actions: Pick<Innertube["actions"], "execute">;
	music: {
		getArtist: (artistId: string) => Promise<unknown>;
		getPlaylist: (
			playlistId: string,
		) => Promise<
			Pick<YTMusic.Playlist, "getContinuation" | "has_continuation"> & {
				readonly items: readonly YTMusic.Playlist["items"][number][];
			}
		>;
	};
};

type MusicSearchType = "song" | "album" | "artist";

type SearchPage = {
	contents?: unknown;
	has_continuation: boolean;
	getContinuation: () => Promise<unknown>;
};

const isSearchPage = (value: unknown): value is SearchPage =>
	typeof asRecord(value)?.["has_continuation"] === "boolean" &&
	typeof asRecord(value)?.["getContinuation"] === "function";

export const searchYoutubeMusic = Effect.fn(function* (
	client: MusicSearchClient,
	query: string,
	type: MusicSearchType,
	pageSize: number,
	page: number,
) {
	const maximumReplayPages = 40;
	const end = page * pageSize;
	const start = end - pageSize;
	let response = yield* tryYoutubeMusic(() => client.music.search(query, { type }));
	const items = new Map<string, ProviderSearchResultItem>();
	for (let replay = 0; ; replay += 1) {
		const contents = asRecord(response)?.["contents"];
		if (contents === undefined) {
			return yield* new MediaSandboxError({ message: "YouTube Music search is missing contents" });
		}
		const nodes = Array.isArray(contents)
			? asArray(contents).flatMap((shelf) => {
					const entries = asRecord(shelf)?.["contents"];
					return asArray(entries);
				})
			: asRecord(contents)?.["contents"];
		if (!Array.isArray(nodes)) {
			return yield* new MediaSandboxError({
				message: "YouTube Music search has malformed contents",
			});
		}
		for (const node of nodes) {
			const record = asRecord(node);
			const externalId = stringValue(record?.["id"]);
			const title =
				stringValue(record?.["name"]) ??
				stringValue(record?.["title"]) ??
				stringValue(asRecord(record?.["title"])?.["text"]);
			if (!externalId || !title) {
				continue;
			}
			const imageUrl = getBestThumbnailUrl(record?.["thumbnail"]);
			const year = numberValue(record?.["year"]);
			items.set(externalId, {
				title,
				externalId,
				...(imageUrl ? { imageUrl } : {}),
				...(year === null ? {} : { metadata: [year] }),
			});
		}
		const hasMore = isSearchPage(response) && response.has_continuation;
		if (items.size >= end || !hasMore) {
			return {
				items: [...items.values()].slice(start, end),
				...(!hasMore
					? { details: { totalItems: items.size, nextPage: items.size > end ? page + 1 : null } }
					: { details: { nextPage: page + 1 } }),
			};
		}
		if (replay + 1 >= maximumReplayPages) {
			return yield* new MediaSandboxError({
				message: "YouTube Music search exceeds the bounded page replay budget",
			});
		}
		if (!isSearchPage(response)) {
			return yield* new MediaSandboxError({
				message: "YouTube Music search continuation is unavailable",
			});
		}
		const previous = response;
		response = yield* tryYoutubeMusic(() => previous.getContinuation());
	}
});

export const coerceTrimmed = (value: unknown) =>
	typeof value === "string" ? value.trim() : String(value).trim();

export const getThumbnailUrls = (thumbnail: unknown): string[] => {
	const contents = asRecord(thumbnail)?.["contents"];
	let arr: readonly unknown[] = [];
	if (Array.isArray(thumbnail)) {
		arr = thumbnail;
	} else if (Array.isArray(contents)) {
		arr = contents;
	}
	return arr
		.flatMap((item) => {
			const record = asRecord(item);
			const url = stringValue(record?.["url"]);
			if (!url) {
				return [];
			}
			const width = numberValue(record?.["width"]) ?? 0;
			const height = numberValue(record?.["height"]) ?? 0;
			return [{ url, size: width * height }];
		})
		.sort((a, b) => b.size - a.size)
		.map((entry) => entry.url);
};

export const getBestThumbnailUrl = (thumbnail: unknown) => getThumbnailUrls(thumbnail)[0] ?? null;

export const createYoutubeMusicClient = (host: YoutubeMusicHost, language?: string) =>
	createSdkYoutubeMusicClient(host, language, {
		retrievePlayer: false,
		retrieveInnertubeConfig: false,
	}).pipe(Effect.mapError(toMediaSandboxError));

export const createYoutubeHistoryClient = (
	host: YoutubeMusicHost,
	authCookie: string,
	timezone: string,
) =>
	createSdkYoutubeHistoryClient(host, authCookie, timezone).pipe(
		Effect.mapBoth({
			onFailure: toMediaSandboxError,
			onSuccess: (client): HistoryClient => ({
				getHistory: () => client.getHistory().pipe(Effect.mapError(toMediaSandboxError)),
			}),
		}),
	);
