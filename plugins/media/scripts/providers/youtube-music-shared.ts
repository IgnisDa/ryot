import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { Innertube } from "@ryot/sandbox-sdk/youtubei";

import { asRecord, numberValue, stringValue } from "../script-helpers/records";

export type YoutubeMusicHost = SandboxHost<readonly ["httpCall"]>;

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

const mergeHeaders = (target: Record<string, string>, source: unknown) => {
	if (source instanceof Headers) {
		for (const [key, value] of source.entries()) {
			target[key] = value;
		}
	} else if (Array.isArray(source)) {
		for (const entry of source) {
			if (Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "string") {
				target[entry[0]] = entry[1];
			}
		}
	} else {
		const record = asRecord(source);
		if (record) {
			for (const [key, value] of Object.entries(record)) {
				if (typeof value === "string") {
					target[key] = value;
				}
			}
		}
	}
};

type RequestParts = {
	url: string;
	method: string;
	body: string | undefined;
	headers: Record<string, string>;
};

const resolveRequestParts = (
	input: Request | string | URL,
	init?: RequestInit,
): Effect.Effect<RequestParts> => {
	const headers: Record<string, string> = {};
	const applyInit = (base: { url: string; method: string; body: string | undefined }) => {
		let method = base.method;
		let body = base.body;
		if (init) {
			if (init.method) {
				method = init.method;
			}
			if (init.headers) {
				mergeHeaders(headers, init.headers);
			}
			const rawBody = init.body;
			if (rawBody !== null && rawBody !== undefined) {
				if (typeof rawBody === "string") {
					body = rawBody;
				} else if (ArrayBuffer.isView(rawBody)) {
					body = new TextDecoder().decode(rawBody);
				} else if (rawBody instanceof ArrayBuffer) {
					body = new TextDecoder().decode(new Uint8Array(rawBody));
				} else if (rawBody instanceof URLSearchParams) {
					body = rawBody.toString();
				}
			}
		}
		return { url: base.url, method, headers, body };
	};
	if (input instanceof Request) {
		mergeHeaders(headers, input.headers);
		return Effect.tryPromise(() => input.text()).pipe(
			Effect.map((text) =>
				applyInit({ url: input.url, method: input.method, body: text ? text : undefined }),
			),
			Effect.catch(() =>
				Effect.succeed(applyInit({ url: input.url, method: input.method, body: undefined })),
			),
		);
	}
	return Effect.succeed(applyInit({ url: String(input), method: "GET", body: undefined }));
};

// The host adapter satisfies the Innertube `fetch` option; `preconnect` is only present to match
// the runtime `typeof fetch` shape and is never invoked by the Innertube client.
export const makeFetch = (host: YoutubeMusicHost): typeof fetch =>
	Object.assign(
		(input: Request | string | URL, init?: RequestInit): Promise<Response> =>
			resolveRequestParts(input, init).pipe(
				Effect.flatMap((parts) => {
					const options: { body?: string; headers?: Record<string, string> } = {};
					if (parts.body !== undefined) {
						options.body = parts.body;
					}
					if (Object.keys(parts.headers).length > 0) {
						options.headers = parts.headers;
					}
					return host.httpCall(parts.method, parts.url, options).pipe(
						Effect.map(
							(result) =>
								new Response(result.body, { status: result.status, headers: result.headers }),
						),
						Effect.catch((error) => Effect.succeed(new Response(error.message, { status: 500 }))),
					);
				}),
				Effect.runPromise,
			),
		{ preconnect: () => undefined },
	);

export const createYoutubeMusicClient = (host: YoutubeMusicHost, language?: string) =>
	Effect.tryPromise(() =>
		Innertube.create({
			fetch: makeFetch(host),
			generate_session_locally: true,
			...(language ? { lang: language } : {}),
		}),
	);

export const createYoutubeHistoryClient = (host: YoutubeMusicHost, authCookie: string) =>
	Effect.tryPromise(() => Innertube.create({ cookie: authCookie, fetch: makeFetch(host) }));
