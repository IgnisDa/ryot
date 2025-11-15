import { isObjectRecord } from "#lib/predicates";
import type { MediaImportAdapterResult } from "#modules/imports/media/adapter-result";
import { buildMovieOrShowImportRef } from "#modules/imports/sources/shared/provider-refs";

import {
	createProgressResult,
	createShowEpisodeLocator,
	parseJsonRecord,
	sinkFailureResult,
	type SinkParser,
	wrapSinkParser,
} from "./shared";

export const parseKodiSinkPayload = (payload: unknown): MediaImportAdapterResult => {
	if (!isObjectRecord(payload)) {
		return sinkFailureResult("Could not parse Kodi webhook payload");
	}

	const lot = payload.lot;
	const progress = payload.progress;
	const identifier = payload.identifier;
	const rawSeason = payload.show_season_number;
	const rawEpisode = payload.show_episode_number;

	if (typeof progress !== "number" || !Number.isFinite(progress)) {
		return sinkFailureResult("Could not parse Kodi webhook payload");
	}

	if (lot !== "movie" && lot !== "show") {
		return sinkFailureResult("Could not parse Kodi webhook payload");
	}

	let normalizedIdentifier = "";
	if (typeof identifier === "string") {
		normalizedIdentifier = identifier.trim();
	} else if (typeof identifier === "number" && Number.isFinite(identifier)) {
		normalizedIdentifier = String(identifier);
	}
	const ref = buildMovieOrShowImportRef({
		entitySchemaSlug: lot,
		sourceLabel: normalizedIdentifier,
		providerIds: { tmdb: normalizedIdentifier },
	});
	if (!ref) {
		return sinkFailureResult("Kodi webhook payload is missing a TMDB identifier");
	}

	const episodeLocator =
		lot === "show"
			? createShowEpisodeLocator(
					typeof rawSeason === "number" ? rawSeason : undefined,
					typeof rawEpisode === "number" ? rawEpisode : undefined,
				)
			: undefined;
	if (lot === "show" && !episodeLocator) {
		return sinkFailureResult("Kodi webhook payload is missing show episode coordinates");
	}

	return createProgressResult({
		entityRef: ref,
		consumedOn: "kodi",
		progressPercent: progress,
		...(episodeLocator ? { episodeLocator } : {}),
	});
};

export const parseKodiSink: SinkParser = (input) =>
	wrapSinkParser("Kodi", () => parseKodiSinkPayload(parseJsonRecord(input.rawBody)));
