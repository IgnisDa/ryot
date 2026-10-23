import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { asRecord } from "@ryot-app/plugin-backend-sdk/wire";

import { getTmdbAccessToken } from "../../lib/vendors/tmdb";
import { tvdbGet } from "../../lib/vendors/tvdb";
import { nestedNumber, pathValue, textValue } from "../shared";
import { isNotFound, searchTmdbShow, tmdbEpisodeExternalIds } from "./tmdb-episode";

type LookupHost = Pick<
	ScriptHost,
	"httpCall" | "getPluginConfig" | "getCachedValue" | "setCachedValue"
>;

const itemId = (payload: unknown, provider: string) =>
	textValue(pathValue(payload, [`Provider_${provider}`])) ??
	textValue(pathValue(payload, [provider])) ??
	textValue(pathValue(payload, ["Item", "ProviderIds", provider]));

export const findJellyfinShow = Effect.fnUntraced(function* (
	payload: unknown,
	provider: "tmdb" | "tvdb",
	host: LookupHost,
) {
	const seriesId =
		textValue(pathValue(payload, [`SeriesProvider_${provider}`])) ??
		textValue(pathValue(payload, ["Series", "ProviderIds", provider]));
	if (seriesId) {
		return seriesId;
	}
	const episodeId = itemId(payload, provider);
	const imdbId = itemId(payload, "imdb");
	const tvdbId = itemId(payload, "tvdb");
	if (!episodeId && (provider === "tvdb" || (!imdbId && !tvdbId))) {
		return undefined;
	}
	const cacheKey = episodeId
		? `${provider}-episode-show:${episodeId}`
		: `tmdb-episode-show-external:${yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))([imdbId ?? null, tvdbId ?? null])}`;
	const cached = asRecord(
		yield* host.getCachedValue(cacheKey).pipe(Effect.orElseSucceed(() => null)),
	);
	if (cached) {
		return textValue(cached["showId"]);
	}
	let showId: string | undefined;
	if (provider === "tvdb" && episodeId) {
		const response = yield* tvdbGet(host, `/episodes/${encodeURIComponent(episodeId)}`).pipe(
			Effect.catchIf(isNotFound, () => Effect.succeed(null)),
		);
		showId = textValue(asRecord(response?.["data"])?.["seriesId"]);
	} else {
		const token = yield* getTmdbAccessToken(host);
		showId =
			(yield* searchTmdbShow(host, token, {
				episodeId,
				externalIds: tmdbEpisodeExternalIds(imdbId, tvdbId),
				seriesName:
					textValue(pathValue(payload, ["SeriesName"])) ??
					textValue(pathValue(payload, ["Item", "SeriesName"])),
				seasonNumber: nestedNumber(payload, [
					"ParentIndexNumber",
					"SeasonNumber",
					"SeasonNumber00",
					"SeasonNumber000",
				]),
			})) ?? undefined;
	}
	if (episodeId || showId) {
		yield* host
			.setCachedValue(cacheKey, { showId: showId ?? null }, 24 * 60 * 60)
			.pipe(Effect.ignore);
	}
	return showId;
});
