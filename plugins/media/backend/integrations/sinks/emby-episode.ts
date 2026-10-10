import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { MediaSandboxError } from "../../lib/failures";
import { asRecord, recordsValue, stringValue } from "../../lib/records";
import { tmdbGet } from "../../lib/vendors/tmdb";
import { firstPathText, nestedNumber, textValue } from "../shared";
import { isNotFound, searchTmdbShow, tmdbEpisodeExternalIds } from "./tmdb-episode";

type LookupHost = Pick<
	ScriptHost,
	"httpCall" | "getPluginConfig" | "getCachedValue" | "setCachedValue"
>;

const episodeId = (payload: unknown, provider: string) =>
	firstPathText(payload, [
		["Item", "ProviderIds", provider],
		["ProviderIds", provider],
		[`Provider_${provider}`],
		[provider],
	]);

const normalizedTitle = (value: unknown) => textValue(value)?.toLowerCase().replace(/\s+/g, " ");

export const findEmbyShow = Effect.fnUntraced(function* (payload: unknown, host: LookupHost) {
	const seriesId = firstPathText(payload, [
		["Series", "ProviderIds", "tmdb"],
		["Item", "SeriesProviderIds", "tmdb"],
		["SeriesProviderIds", "tmdb"],
		["Item", "SeriesProvider_tmdb"],
		["Item", "SeriesProvidertmdb"],
		["SeriesProvider_tmdb"],
		["SeriesProvidertmdb"],
	]);
	if (seriesId) {
		return seriesId;
	}
	const tmdbId = episodeId(payload, "tmdb");
	const imdbId = episodeId(payload, "imdb");
	const tvdbId = episodeId(payload, "tvdb");
	const seriesName = firstPathText(payload, [
		["Item", "SeriesName"],
		["SeriesName"],
		["Series", "Name"],
	]);
	const episodeName = firstPathText(payload, [
		["Item", "EpisodeTitle"],
		["Item", "Name"],
		["EpisodeTitle"],
		["Name"],
		["Title"],
	]);
	const seasonNumber = nestedNumber(payload, ["ParentIndexNumber", "SeasonNumber"]);
	const episodeNumber = nestedNumber(payload, ["IndexNumber", "EpisodeNumber"]);
	if (!tmdbId && !imdbId && !tvdbId && !(seriesName && episodeName)) {
		return undefined;
	}
	const cacheKey = `emby-tmdb-episode-show:${yield* Schema.encodeEffect(
		Schema.fromJsonString(Schema.Unknown),
	)([
		tmdbId ?? null,
		imdbId ?? null,
		tvdbId ?? null,
		seriesName ?? null,
		episodeName ?? null,
		seasonNumber ?? null,
		episodeNumber ?? null,
	])}`;
	const cached = asRecord(
		yield* host.getCachedValue(cacheKey).pipe(Effect.orElseSucceed(() => null)),
	);
	const cachedShowId = textValue(cached?.["showId"]);
	if (cachedShowId) {
		return cachedShowId;
	}
	const config = yield* host.getPluginConfig({ optional: ["tmdbAccessToken"] });
	const token = stringValue(config.tmdbAccessToken);
	if (!token) {
		return yield* new MediaSandboxError({ message: "TMDB access token is not configured" });
	}
	let showId = yield* searchTmdbShow(host, token, {
		seriesName,
		seasonNumber,
		episodeId: tmdbId,
		externalIds: tmdbEpisodeExternalIds(imdbId, tvdbId),
	});
	if (
		!showId &&
		!tmdbId &&
		seriesName &&
		episodeName &&
		seasonNumber !== undefined &&
		episodeNumber !== undefined
	) {
		const search = yield* tmdbGet(host, "/search/tv", { query: seriesName }, token);
		if (typeof search["total_pages"] === "number" && search["total_pages"] > 1) {
			return undefined;
		}
		const matches = new Set<string>();
		for (const show of recordsValue(search["results"])) {
			const id = textValue(show["id"]);
			if (
				!id ||
				![show["name"], show["original_name"]].some(
					(name) => normalizedTitle(name) === normalizedTitle(seriesName),
				)
			) {
				continue;
			}
			const season = yield* tmdbGet(
				host,
				`/tv/${encodeURIComponent(id)}/season/${seasonNumber}`,
				{},
				token,
			).pipe(Effect.catchIf(isNotFound, () => Effect.succeed(null)));
			if (
				recordsValue(season?.["episodes"]).some(
					(candidate) =>
						candidate["episode_number"] === episodeNumber &&
						normalizedTitle(candidate["name"]) === normalizedTitle(episodeName),
				)
			) {
				matches.add(id);
			}
		}
		if (matches.size === 1) {
			showId = [...matches][0] ?? null;
		}
	}
	if (showId) {
		yield* host.setCachedValue(cacheKey, { showId }, 24 * 60 * 60).pipe(Effect.ignore);
	}
	return showId ?? undefined;
});
