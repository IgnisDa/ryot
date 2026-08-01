import type { YoutubeiHost } from "@ryot/sandbox-sdk/youtubei";
import {
	createYoutubeHistoryClient as createSdkYoutubeHistoryClient,
	createYoutubeMusicClient as createSdkYoutubeMusicClient,
} from "@ryot/sandbox-sdk/youtubei";

import { asRecord, numberValue, stringValue } from "../script-helpers/records";

export type YoutubeMusicHost = YoutubeiHost;

type MusicSearchType = "song" | "artist" | "album";

export type MusicSearchClient = {
	music: { search: (query: string, filters: { type: MusicSearchType }) => Promise<unknown> };
};

export type TrackQueueClient = { music: { getUpNext: (videoId: string) => Promise<unknown> } };

export type ArtistClient = { music: { getArtist: (artistId: string) => Promise<unknown> } };

export type AlbumClient = { music: { getAlbum: (albumId: string) => Promise<unknown> } };

export type HistoryClient = { getHistory: () => Promise<unknown> };

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
	createSdkYoutubeMusicClient(host, language);

export const createYoutubeHistoryClient = (host: YoutubeMusicHost, authCookie: string) =>
	createSdkYoutubeHistoryClient(host, authCookie);
