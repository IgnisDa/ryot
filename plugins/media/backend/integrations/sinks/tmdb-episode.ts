import { Effect } from "@ryot-app/plugin-backend-sdk/effect";

import { asRecord, numberValue, recordsValue } from "../../lib/records";
import { tmdbGet, type TmdbHost } from "../../lib/vendors/tmdb";

export type TmdbEpisode = {
	episodeId: string | undefined;
	seriesName: string | undefined;
	seasonNumber: number | undefined;
	externalIds: ReadonlyArray<readonly [string, "imdb_id" | "tvdb_id"]>;
};

export const isNotFound = (error: unknown) =>
	asRecord(asRecord(error)?.["data"])?.["status"] === 404;

const tmdbId = (value: unknown) => {
	const id = numberValue(value);
	return id === null ? null : String(Math.trunc(id));
};

export const searchTmdbShow = Effect.fnUntraced(function* (
	host: TmdbHost,
	token: string,
	episode: TmdbEpisode,
) {
	for (const [externalId, source] of episode.externalIds) {
		const found = yield* tmdbGet(
			host,
			`/find/${encodeURIComponent(externalId)}`,
			{ external_source: source },
			token,
		);
		const showId = tmdbId(recordsValue(found["tv_episode_results"])[0]?.["show_id"]);
		if (showId) {
			return showId;
		}
	}
	if (!episode.seriesName || !episode.episodeId || episode.seasonNumber === undefined) {
		return null;
	}
	const search = yield* tmdbGet(host, "/search/tv", { query: episode.seriesName }, token);
	for (const show of recordsValue(search["results"]).slice(0, 5)) {
		const showId = tmdbId(show["id"]);
		if (!showId) {
			continue;
		}
		const season = yield* Effect.catchIf(
			tmdbGet(host, `/tv/${showId}/season/${episode.seasonNumber}`, {}, token),
			isNotFound,
			() => Effect.succeed(null),
		);
		if (
			recordsValue(season?.["episodes"]).some(
				(candidate) => tmdbId(candidate["id"]) === episode.episodeId,
			)
		) {
			return showId;
		}
	}
	return null;
});
