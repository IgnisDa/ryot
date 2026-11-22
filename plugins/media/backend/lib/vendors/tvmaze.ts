import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { DateTime, Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import type { ProviderDetailsChildEntity } from "@ryot-app/plugin-backend-sdk/provider";
import { asRecord } from "@ryot-app/plugin-backend-sdk/wire";

import { MediaSandboxError } from "../failures";
import { decodeJsonResponse, jsonObject, numberValue, recordsValue, stringValue } from "../records";
import { releaseInstant } from "../release-time";

type ShowIdentity = { readonly id: string; readonly kind: "imdb" | "thetvdb" };
type TvmazeHost = Pick<ScriptHost, "log" | "httpCall" | "getCachedValue" | "setCachedValue">;

const hour = 60 * 60;
const day = 24 * hour;

const EpisodeSchedule = Schema.Struct({
	confirmedAt: Schema.String,
	episodes: Schema.Array(
		Schema.Struct({
			id: Schema.Int,
			season: Schema.Int,
			number: Schema.Int,
			date: Schema.String,
			instant: Schema.String,
		}),
	),
});

const get = Effect.fnUntraced(function* (host: TvmazeHost, path: string) {
	const response = yield* host.httpCall("GET", `https://api.tvmaze.com${path}`);
	if (response.status === 404) {
		return null;
	}
	if (response.status !== 200) {
		return yield* new MediaSandboxError({ message: `TVmaze request returned ${response.status}` });
	}
	return yield* decodeJsonResponse(response.body, "TVmaze");
});

const readCache = (host: TvmazeHost, key: string) =>
	host.getCachedValue(key).pipe(Effect.orElseSucceed(() => null));

const reportUnavailable = (host: TvmazeHost, reason: string) =>
	host
		.log([
			{ level: "warning", attributes: { reason }, message: "TVmaze airing schedule unavailable" },
		])
		.pipe(Effect.orElseSucceed(() => null));

const showId = Effect.fnUntraced(function* (host: TvmazeHost, identities: readonly ShowIdentity[]) {
	for (const { id, kind } of identities) {
		const key = `tvmaze:lookup:${kind}:${id}`;
		const cached = numberValue(yield* readCache(host, key));
		if (cached !== null) {
			return cached;
		}
		const found = numberValue(
			asRecord(yield* get(host, `/lookup/shows?${kind}=${encodeURIComponent(id)}`))?.["id"],
		);
		if (found !== null && Number.isSafeInteger(found) && found > 0) {
			yield* host.setCachedValue(key, found, 7 * day).pipe(Effect.orElseSucceed(() => null));
			return found;
		}
	}
	return null;
});

const schedule = Effect.fnUntraced(function* (host: TvmazeHost, tvmazeShowId: number) {
	const key = `tvmaze:episodes:${tvmazeShowId}`;
	const cached = Schema.decodeUnknownOption(EpisodeSchedule)(yield* readCache(host, key));
	const now = yield* DateTime.now;
	const old = cached._tag === "Some" ? cached.value : null;
	if (old && DateTime.toEpochMillis(now) - Date.parse(old.confirmedAt) < hour * 1000) {
		return old;
	}
	return yield* Effect.gen(function* () {
		const payload = yield* get(host, `/shows/${tvmazeShowId}/episodes`);
		if (!Array.isArray(payload)) {
			return yield* new MediaSandboxError({ message: "TVmaze did not return an episode list" });
		}
		const episodes = recordsValue(payload).flatMap((episode) => {
			const id = numberValue(episode["id"]);
			const season = numberValue(episode["season"]);
			const number = numberValue(episode["number"]);
			const date = stringValue(episode["airdate"]);
			const instant = stringValue(episode["airtime"]) ? releaseInstant(episode["airstamp"]) : null;
			return id && season && number && date && instant
				? [{ id, date, season, number, instant }]
				: [];
		});
		const result = { episodes, confirmedAt: DateTime.formatIso(now) };
		yield* host.setCachedValue(key, result, 7 * day).pipe(Effect.orElseSucceed(() => null));
		return result;
	}).pipe(Effect.catch((error) => reportUnavailable(host, error.message).pipe(Effect.as(old))));
});

const position = (season: number, episode: number) => `${season}:${episode}`;

export const enrichShowAirtimes = Effect.fnUntraced(function* (
	host: TvmazeHost,
	identities: readonly ShowIdentity[],
	seasons: readonly ProviderDetailsChildEntity[],
) {
	if (identities.length === 0 || !seasons.some(({ childEntities }) => childEntities?.length)) {
		return seasons;
	}
	const id = yield* showId(host, identities).pipe(
		Effect.catch((error) => reportUnavailable(host, error.message).pipe(Effect.as(null))),
	);
	const timings = id === null ? null : yield* schedule(host, id);
	if (timings === null) {
		return seasons;
	}
	const byPosition = new Map<string, null | (typeof timings.episodes)[number]>();
	for (const airing of timings.episodes) {
		const key = position(airing.season, airing.number);
		byPosition.set(key, byPosition.has(key) ? null : airing);
	}
	return seasons.map((season) => ({
		...season,
		childEntities: season.childEntities?.map((episode) => {
			const properties = jsonObject(episode.properties);
			const seasonNumber = numberValue(properties?.["seasonNumber"]);
			const episodeNumber = numberValue(properties?.["episodeNumber"]);
			if (properties === null || seasonNumber === null || episodeNumber === null) {
				return episode;
			}
			const airing = byPosition.get(position(seasonNumber, episodeNumber));
			if (!airing || properties["publishDate"] !== airing.date) {
				return episode;
			}
			return {
				...episode,
				properties: {
					...properties,
					airingAt: airing.instant,
					airingConfirmedAt: timings.confirmedAt,
					airingSourceUrl: `https://www.tvmaze.com/episodes/${airing.id}`,
				},
			};
		}),
	}));
});
